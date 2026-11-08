import type { FbrEnvironment, Prisma } from '@prisma/client';
import { prisma } from '../../db.js';
import { sha256Hex } from '../../lib/crypto.js';
import { AppError } from '../../lib/errors.js';
import { registerJob } from '../../jobs/runner.js';
import { notifyBusiness } from '../notifications/notify.js';
import { createInvoice, localValidate, prepareItems, submitToFbr, toPayloadInvoice, validateWithFbr, type Ctx } from '../invoices/service.js';
import { parseWorkbook, type RowIssue } from './excel.js';

/** Upload → parse → preview → local validation. Nothing is sent to FBR here. */
export async function createImportJob(ctx: Ctx, filename: string, buf: Buffer, env: FbrEnvironment) {
  const business = await prisma.business.findUniqueOrThrow({ where: { id: ctx.businessId } });
  if (env === 'PRODUCTION' && !business.productionEnabled) throw new AppError(409, 'PRODUCTION_DISABLED', 'Production submission is not enabled for this business.');
  const sha = sha256Hex(buf);
  const { invoices, fileIssues, totalRows } = await parseWorkbook(buf, env);
  const prior = await prisma.importJob.findFirst({ where: { businessId: ctx.businessId, fileSha256: sha }, orderBy: { createdAt: 'desc' } });
  if (prior) fileIssues.push({ importRef: '', row: 0, field: 'file', level: 'warning', message: `This exact file was already uploaded on ${prior.createdAt.toISOString().slice(0, 16).replace('T', ' ')} UTC (job ${prior.id}). Invoices already accepted by FBR will be skipped.`, scope: 'file' });

  // Invoices previously accepted with the same import_ref are never resubmitted.
  const refs = invoices.map((i) => i.importRef);
  const accepted = refs.length
    ? await prisma.invoice.findMany({ where: { businessId: ctx.businessId, environment: env, importRef: { in: refs }, status: { in: ['ACCEPTED', 'RECONCILIATION_REQUIRED', 'SUBMITTING'] } }, select: { importRef: true, internalNumber: true, status: true, fbrInvoiceNumber: true } })
    : [];

  const seller = { sellerNtnCnic: business.ntnCnic, sellerBusinessName: business.name, sellerProvince: business.province, sellerAddress: business.address };
  const fileBlocking = fileIssues.some((i) => i.level === 'error');
  const job = await prisma.importJob.create({
    data: {
      businessId: ctx.businessId,
      environment: env,
      filename: filename.slice(0, 200),
      fileSha256: sha,
      totalInvoices: invoices.length,
      totalRows,
      fileErrors: fileIssues as unknown as Prisma.InputJsonValue,
      createdById: ctx.userId,
      status: fileBlocking ? 'FAILED' : 'PARSED',
    },
  });
  for (const inv of invoices) {
    const issues: RowIssue[] = [...inv.issues];
    const dup = accepted.find((a) => a.importRef === inv.importRef);
    let status = 'READY';
    if (dup) {
      status = 'SKIPPED_DUPLICATE';
      issues.push({ importRef: inv.importRef, row: inv.rows[0], field: 'import_ref', level: 'error', message: `Already ${dup.status === 'ACCEPTED' ? `accepted by FBR (${dup.fbrInvoiceNumber})` : dup.status.toLowerCase().replace(/_/g, ' ')} as ${dup.internalNumber}; it will not be resubmitted`, scope: 'invoice' });
    } else {
      // Local calculation + contract validation on a synthetic record (same code path as the builder)
      const { rows, issues: calcIssues } = prepareItems(inv.input.items, true);
      const synthetic = toPayloadInvoice({ ...inv.input, ...seller, invoiceDate: inv.input.invoiceDate, buyerNtnCnic: inv.input.buyerNtnCnic ?? '', invoiceRefNo: inv.input.invoiceRefNo ?? '', scenarioId: inv.input.scenarioId ?? null } as never, rows);
      const local = [...calcIssues, ...localValidate(synthetic, env, { autoCalc: true })];
      for (const li of local) {
        const row = li.line ? inv.rows[li.line - 1] ?? inv.rows[0] : inv.rows[0];
        // month-rule and required-field errors are already reported with column names by the parser
        if (issues.some((x) => x.row === row && x.message === li.message)) continue;
        issues.push({ importRef: inv.importRef, row, field: li.field, level: li.level, message: li.message, scope: li.line ? 'item' : 'invoice' });
      }
      if (issues.some((i) => i.level === 'error')) status = 'LOCAL_INVALID';
    }
    await prisma.importInvoice.create({
      data: {
        jobId: job.id,
        importRef: inv.importRef,
        rowNumbers: inv.rows,
        status,
        data: inv.input as unknown as Prisma.InputJsonValue,
        errors: issues.filter((i) => i.level === 'error') as unknown as Prisma.InputJsonValue,
        warnings: issues.filter((i) => i.level === 'warning') as unknown as Prisma.InputJsonValue,
      },
    });
  }
  await refreshCounts(job.id);
  return job;
}

export async function refreshCounts(jobId: string) {
  const rows = await prisma.importInvoice.groupBy({ by: ['status'], where: { jobId }, _count: true });
  const counts = Object.fromEntries(rows.map((r) => [r.status, r._count]));
  await prisma.importJob.update({ where: { id: jobId }, data: { counts } });
  return counts;
}

async function loadJob(ctx: Ctx, jobId: string) {
  const job = await prisma.importJob.findFirst({ where: { id: jobId, businessId: ctx.businessId } });
  if (!job) throw new AppError(404, 'NOT_FOUND', 'Import job not found');
  return job;
}

/** Create drafts for selected locally-valid invoices. */
export async function createDrafts(ctx: Ctx, jobId: string, refs: string[] | 'ALL_READY') {
  const job = await loadJob(ctx, jobId);
  const where: Prisma.ImportInvoiceWhereInput = { jobId: job.id, status: 'READY', ...(refs === 'ALL_READY' ? {} : { importRef: { in: refs } }) };
  const rows = await prisma.importInvoice.findMany({ where });
  const results: { importRef: string; ok: boolean; message?: string }[] = [];
  for (const r of rows) {
    try {
      const { invoice } = await createInvoice(ctx, r.data as never, { environment: job.environment, source: 'EXCEL', importJobId: job.id, importRef: r.importRef });
      await prisma.importInvoice.update({ where: { id: r.id }, data: { status: 'DRAFT_CREATED', invoiceId: invoice.id } });
      results.push({ importRef: r.importRef, ok: true });
    } catch (e) {
      const msg = (e as Error).message;
      await prisma.importInvoice.update({ where: { id: r.id }, data: { status: 'LOCAL_INVALID', errors: [...((r.errors as unknown[]) ?? []), { importRef: r.importRef, row: r.rowNumbers[0], field: 'invoice', level: 'error', message: msg, scope: 'invoice' }] as Prisma.InputJsonValue } });
      results.push({ importRef: r.importRef, ok: false, message: msg });
    }
  }
  await prisma.importJob.update({ where: { id: job.id }, data: { status: 'DRAFTS_CREATED' } });
  await refreshCounts(job.id);
  return results;
}

const fbrIssueRows = (importRef: string, row: number, issues: { code?: string | null; message: string; itemSNo?: string; field?: string }[], rows: number[]) =>
  issues.map((i) => ({
    importRef,
    row: i.itemSNo ? rows[Number(i.itemSNo) - 1] ?? row : row,
    field: i.field ?? (i.itemSNo ? `item ${i.itemSNo}` : 'invoice'),
    level: 'error',
    message: i.message,
    fbrCode: i.code ?? undefined,
    scope: i.itemSNo ? 'item' : 'invoice',
  }));

function prevProcessed(progress: Prisma.JsonValue): string[] {
  const p = progress as { processed?: unknown } | null;
  return Array.isArray(p?.processed) ? (p!.processed as unknown[]).filter((x): x is string => typeof x === 'string') : [];
}

let registered = false;
/** Background handlers. Each invoice is processed independently; one failure never marks the batch successful. */
export function registerBulkJobs() {
  if (registered) return;
  registered = true;
  registerJob('bulk.validate', async (job, progress) => {
    const p = job.payload as { jobId: string; refs: string[]; userId: string };
    const ctx: Ctx = { businessId: job.businessId!, userId: p.userId, kind: 'USER' };
    const items = await prisma.importInvoice.findMany({ where: { jobId: p.jobId, job: { businessId: ctx.businessId }, importRef: { in: p.refs }, invoiceId: { not: null } }, orderBy: { importRef: 'asc' } });
    const processed = new Set(prevProcessed(job.progress));
    let done = processed.size;
    for (const it of items) {
      if (processed.has(it.importRef)) continue;
      if (Date.now() >= job.deadline) return 'PARTIAL';
      try {
        const r = await validateWithFbr(ctx, it.invoiceId!);
        await prisma.importInvoice.update({
          where: { id: it.id },
          data: { status: r.outcome === 'VALID' ? 'FBR_VALID' : 'FBR_INVALID', fbrResult: { outcome: r.outcome, httpStatus: r.httpStatus, attemptId: r.attemptId } as Prisma.InputJsonValue, errors: fbrIssueRows(it.importRef, it.rowNumbers[0], r.issues, it.rowNumbers) as unknown as Prisma.InputJsonValue },
        });
      } catch (e) {
        const err = e as AppError;
        const details = (err.details as { issues?: { field: string; message: string; line?: number }[] })?.issues;
        await prisma.importInvoice.update({
          where: { id: it.id },
          data: {
            status: 'FBR_INVALID',
            errors: (details?.length
              ? details.map((d) => ({ importRef: it.importRef, row: d.line ? it.rowNumbers[d.line - 1] : it.rowNumbers[0], field: d.field, level: 'error', message: d.message, scope: d.line ? 'item' : 'invoice' }))
              : [{ importRef: it.importRef, row: it.rowNumbers[0], field: 'invoice', level: 'error', message: err.message, scope: 'invoice' }]) as Prisma.InputJsonValue,
          },
        });
      }
      processed.add(it.importRef);
      done++;
      await progress({ done, total: items.length, processed: [...processed] });
    }
    await prisma.importJob.update({ where: { id: p.jobId }, data: { status: 'VALIDATED' } });
    await refreshCounts(p.jobId);
  });

  registerJob('bulk.submit', async (job, progress) => {
    const p = job.payload as { jobId: string; refs: string[]; userId: string };
    const ctx: Ctx = { businessId: job.businessId!, userId: p.userId, kind: 'USER' };
    const items = await prisma.importInvoice.findMany({ where: { jobId: p.jobId, job: { businessId: ctx.businessId }, importRef: { in: p.refs }, invoiceId: { not: null } }, orderBy: { importRef: 'asc' } });
    const processed = new Set(prevProcessed(job.progress));
    let done = processed.size;
    for (const it of items) {
      if (processed.has(it.importRef)) continue;
      if (Date.now() >= job.deadline) return 'PARTIAL';
      const inv = await prisma.invoice.findFirst({ where: { id: it.invoiceId!, businessId: ctx.businessId } });
      if (!inv || inv.status === 'ACCEPTED') {
        processed.add(it.importRef);
        done++;
        await progress({ done, total: items.length, processed: [...processed] });
        continue; // never resubmit accepted invoices
      }
      try {
        const r = await submitToFbr(ctx, it.invoiceId!, { emailFailures: false }); // one summary email at the end instead
        const status = r.invoice.status === 'ACCEPTED' ? 'ACCEPTED' : r.invoice.status === 'RECONCILIATION_REQUIRED' ? 'RECONCILIATION_REQUIRED' : r.invoice.status === 'REJECTED' ? 'REJECTED' : 'NOT_SENT';
        await prisma.importInvoice.update({
          where: { id: it.id },
          data: { status, fbrResult: { outcome: r.outcome, httpStatus: r.httpStatus, fbrInvoiceNumber: r.invoice.fbrInvoiceNumber, attemptId: r.attemptId } as Prisma.InputJsonValue, errors: fbrIssueRows(it.importRef, it.rowNumbers[0], status === 'ACCEPTED' ? [] : r.issues, it.rowNumbers) as unknown as Prisma.InputJsonValue },
        });
      } catch (e) {
        await prisma.importInvoice.update({
          where: { id: it.id },
          data: { status: 'ERROR', errors: [{ importRef: it.importRef, row: it.rowNumbers[0], field: 'invoice', level: 'error', message: (e as Error).message, scope: 'invoice' }] as Prisma.InputJsonValue },
        });
      }
      processed.add(it.importRef);
      done++;
      await progress({ done, total: items.length, processed: [...processed] });
    }
    const imp = await prisma.importJob.update({ where: { id: p.jobId }, data: { status: 'COMPLETED' } });
    const counts = (await refreshCounts(p.jobId)) as Record<string, number>;
    const accepted = counts.ACCEPTED ?? 0;
    const reconcile = counts.RECONCILIATION_REQUIRED ?? 0;
    const failed = (counts.REJECTED ?? 0) + (counts.NOT_SENT ?? 0) + (counts.ERROR ?? 0);
    if (reconcile > 0 || failed > 0) {
      await notifyBusiness(
        ctx.businessId,
        'BULK_SUBMISSION_FINISHED',
        `Bulk upload ${imp.filename}: ${failed + reconcile} invoice(s) need attention`,
        `${accepted} accepted by FBR, ${failed} not accepted, ${reconcile} need reconciliation (outcome uncertain; do not resend until reconciled).`,
        `/app/bulk/${p.jobId}`,
      );
    }
  });
}
