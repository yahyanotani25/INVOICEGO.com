import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../db.js';
import { audit } from '../../lib/audit.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { karachiNow } from '../../lib/time.js';
import { requireBusiness, requireMember } from '../../plugins/auth.js';
import { enqueue } from '../../jobs/runner.js';
import { buildErrorReport, buildTemplate } from './excel.js';
import { createDrafts, createImportJob } from './service.js';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export async function bulkRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireBusiness);
  const ctxOf = (req: { auth?: { businessId: string | null; user: { id: string } } }) => ({ businessId: req.auth!.businessId!, userId: req.auth!.user.id, kind: 'USER' as const });

  app.get('/bulk/template', async (_req, reply) => {
    const buf = await buildTemplate(karachiNow().date);
    return reply.type(XLSX_MIME).header('content-disposition', 'attachment; filename="invoicego-bulk-template.xlsx"').send(buf);
  });

  app.post('/bulk/upload', { preHandler: requireMember('invoice.write'), config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const file = await req.file();
    if (!file) throw badRequest('Choose an .xlsx file');
    const env = String((file.fields.environment as { value?: string } | undefined)?.value ?? 'SANDBOX').toUpperCase();
    if (env !== 'SANDBOX' && env !== 'PRODUCTION') throw badRequest('Invalid environment');
    if (!/\.xlsx$/i.test(file.filename)) throw badRequest('Only .xlsx files are accepted');
    const buf = await file.toBuffer();
    if (file.file.truncated) throw badRequest('File is too large (maximum 5 MB)');
    if (buf.subarray(0, 2).toString() !== 'PK') throw badRequest('File content is not an .xlsx workbook');
    const job = await createImportJob(ctxOf(req), file.filename, buf, env);
    await audit(req, { action: 'bulk.upload', entityType: 'ImportJob', entityId: job.id, metadata: { filename: file.filename, environment: env } });
    return reply.status(201).send({ id: job.id });
  });

  app.get('/bulk/jobs', async (req) => {
    const rows = await prisma.importJob.findMany({ where: { businessId: req.auth!.businessId! }, orderBy: { createdAt: 'desc' }, take: 50 });
    return rows;
  });

  app.get('/bulk/jobs/:id', async (req) => {
    const { id } = req.params as { id: string };
    const job = await prisma.importJob.findFirst({ where: { id, businessId: req.auth!.businessId! }, include: { invoices: { orderBy: { importRef: 'asc' } } } });
    if (!job) throw notFound('Import job');
    const invIds = job.invoices.map((i) => i.invoiceId).filter((x): x is string => !!x);
    const invs = invIds.length ? await prisma.invoice.findMany({ where: { id: { in: invIds }, businessId: req.auth!.businessId! }, select: { id: true, internalNumber: true, status: true, fbrInvoiceNumber: true, grandTotal: true } }) : [];
    const running = await prisma.job.findMany({ where: { businessId: req.auth!.businessId!, type: { in: ['bulk.validate', 'bulk.submit'] }, status: { in: ['QUEUED', 'RUNNING'] }, payload: { path: ['jobId'], equals: id } } });
    return {
      ...job,
      running: running.map((r) => ({ id: r.id, type: r.type, status: r.status, progress: r.progress })),
      invoices: job.invoices.map((i) => ({ ...i, invoice: invs.find((x) => x.id === i.invoiceId) ?? null })),
    };
  });

  app.post('/bulk/jobs/:id/drafts', { preHandler: requireMember('invoice.write') }, async (req) => {
    const { id } = req.params as { id: string };
    const { refs } = z.object({ refs: z.union([z.literal('ALL_READY'), z.array(z.string()).max(500)]) }).parse(req.body);
    const results = await createDrafts(ctxOf(req), id, refs);
    await audit(req, { action: 'bulk.drafts', entityType: 'ImportJob', entityId: id, metadata: { count: results.length } });
    return { results };
  });

  async function queue(req: { params: unknown; body: unknown; auth?: { businessId: string | null; user: { id: string } } }, type: 'bulk.validate' | 'bulk.submit') {
    const { id } = req.params as { id: string };
    const { refs } = z.object({ refs: z.array(z.string()).min(1).max(500) }).parse(req.body);
    const job = await prisma.importJob.findFirst({ where: { id, businessId: req.auth!.businessId! } });
    if (!job) throw notFound('Import job');
    const busy = await prisma.job.count({ where: { businessId: req.auth!.businessId!, type: { in: ['bulk.validate', 'bulk.submit'] }, status: { in: ['QUEUED', 'RUNNING'] }, payload: { path: ['jobId'], equals: id } } });
    if (busy) throw conflict('A validation or submission run is already in progress for this upload.');
    const eligibleStatus = type === 'bulk.validate' ? ['DRAFT_CREATED', 'FBR_INVALID', 'FBR_VALID', 'NOT_SENT'] : ['FBR_VALID', 'NOT_SENT'];
    const eligible = await prisma.importInvoice.findMany({ where: { jobId: id, importRef: { in: refs }, status: { in: eligibleStatus }, invoiceId: { not: null } }, select: { importRef: true } });
    if (!eligible.length) throw badRequest(type === 'bulk.validate' ? 'Create drafts first; only drafts can be validated with FBR.' : 'Only invoices that passed FBR validation can be submitted.');
    const j = await enqueue(type, { jobId: id, refs: eligible.map((e) => e.importRef), userId: req.auth!.user.id }, { businessId: req.auth!.businessId!, createdById: req.auth!.user.id });
    await prisma.importJob.update({ where: { id }, data: { status: type === 'bulk.validate' ? 'VALIDATING' : 'SUBMITTING' } });
    return { queued: eligible.length, skipped: refs.length - eligible.length, runId: j.id };
  }

  app.post('/bulk/jobs/:id/validate', { preHandler: requireMember('invoice.submit') }, async (req) => {
    const r = await queue(req, 'bulk.validate');
    await audit(req, { action: 'bulk.validate', entityType: 'ImportJob', entityId: (req.params as { id: string }).id, metadata: r });
    return r;
  });

  app.post('/bulk/jobs/:id/submit', { preHandler: requireMember('invoice.submit') }, async (req) => {
    const r = await queue(req, 'bulk.submit');
    await audit(req, { action: 'bulk.submit', entityType: 'ImportJob', entityId: (req.params as { id: string }).id, metadata: r });
    return r;
  });

  app.get('/bulk/jobs/:id/errors.xlsx', async (req, reply) => {
    const { id } = req.params as { id: string };
    const job = await prisma.importJob.findFirst({ where: { id, businessId: req.auth!.businessId! }, include: { invoices: true } });
    if (!job) throw notFound('Import job');
    const rows: Parameters<typeof buildErrorReport>[0] = [];
    for (const f of job.fileErrors as { row: number; level: string; field: string; message: string; fbrCode?: string }[]) rows.push({ importRef: '(file)', status: job.status, row: f.row, level: f.level, field: f.field, message: f.message });
    for (const inv of job.invoices) {
      for (const e of [...((inv.errors as { row: number; level: string; field: string; message: string; fbrCode?: string }[]) ?? []), ...((inv.warnings as { row: number; level: string; field: string; message: string; fbrCode?: string }[]) ?? [])]) {
        rows.push({ importRef: inv.importRef, status: inv.status, row: e.row, level: e.level, field: e.field, message: e.message, fbrCode: e.fbrCode });
      }
    }
    const buf = await buildErrorReport(rows);
    return reply.type(XLSX_MIME).header('content-disposition', `attachment; filename="invoicego-import-${id}-errors.xlsx"`).send(buf);
  });
}
