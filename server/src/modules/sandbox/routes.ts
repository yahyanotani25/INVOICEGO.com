import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../db.js';
import { audit } from '../../lib/audit.js';
import { AppError, notFound } from '../../lib/errors.js';
import { karachiNow } from '../../lib/time.js';
import { requireBusiness, requireMember } from '../../plugins/auth.js';
import { buildPayload, serializePayload } from '../../fbr/payload.js';
import { explainIssues } from '../../fbr/explain.js';
import { computeApplicability, type MatrixRow } from './applicability.js';
import { jsonToInvoiceInput, prepareTemplate } from './prepare.js';
import { createInvoice, getInvoice, invoiceDto, toPayloadInvoice, updateInvoice, type Ctx } from '../invoices/service.js';

export async function loadApplicability(businessId: string) {
  const [b, rules, defs, anomalies, progress] = await Promise.all([
    prisma.business.findUniqueOrThrow({ where: { id: businessId } }),
    prisma.applicabilityRule.findMany(),
    prisma.scenarioDefinition.findMany({ orderBy: { sortOrder: 'asc' } }),
    prisma.sourceAnomaly.findMany({ where: { dataset: 'applicability' } }),
    prisma.scenarioProgress.findMany({ where: { businessId } }),
  ]);
  const result = computeApplicability(
    { activities: b.businessActivities, sector: b.sector, retailerRegistered: b.retailerRegistered, officialIds: b.officialScenarioIds },
    rules as MatrixRow[],
    defs.map((d) => d.id),
    anomalies,
  );
  return { business: b, defs, result, progress };
}

export async function sandboxRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireBusiness);
  const ctxOf = (req: { auth?: { businessId: string | null; user: { id: string } } }): Ctx => ({ businessId: req.auth!.businessId!, userId: req.auth!.user.id, kind: 'USER' });

  app.get('/sandbox/scenarios', async (req) => {
    const { business, defs, result, progress } = await loadApplicability(req.auth!.businessId!);
    const templates = await prisma.scenarioTemplate.findMany({ select: { scenarioId: true, title: true, anomalies: true } });
    const rows = defs.map((d) => {
      const p = progress.find((x) => x.scenarioId === d.id);
      const t = templates.find((x) => x.scenarioId === d.id);
      return {
        id: d.id,
        description: d.description,
        saleTypeLabel: d.saleTypeLabel,
        saleTypeApi: d.saleTypeApi,
        retailerOnly: d.retailerOnly,
        purchaseType: d.purchaseType,
        templateTitle: t?.title ?? null,
        templateAnomalies: t?.anomalies ?? [],
        applicability: result.scenarios[d.id],
        progress: p ? { status: p.status, attempts: p.attempts, lastAttemptAt: p.lastAttemptAt, lastOutcome: p.lastOutcome, passedAt: p.passedAt, passedFbrNumber: p.passedFbrNumber, passedInvoiceId: p.passedInvoiceId } : { status: 'NOT_STARTED', attempts: 0 },
      };
    });
    const required = result.required;
    const passed = required.filter((id) => progress.find((p) => p.scenarioId === id)?.status === 'PASSED');
    return {
      profile: { businessActivities: business.businessActivities, sector: business.sector, retailerRegistered: business.retailerRegistered, officialScenarioIds: business.officialScenarioIds },
      summary: { required: required.length, passed: passed.length, remaining: required.filter((x) => !passed.includes(x)) },
      applicability: { required, computedRequired: result.computedRequired, usedOfficial: result.usedOfficial, officialDiff: result.officialDiff, missingCombinations: result.missingCombinations, notes: result.notes },
      scenarios: rows,
    };
  });

  app.get('/sandbox/scenarios/:id/template', async (req) => {
    const { id } = req.params as { id: string };
    const t = await prisma.scenarioTemplate.findUnique({ where: { scenarioId: id } });
    if (!t) throw notFound('Scenario template');
    const b = await prisma.business.findUniqueOrThrow({ where: { id: req.auth!.businessId! } });
    const prep = prepareTemplate(t.json as Record<string, unknown>, { ntnCnic: b.ntnCnic, name: b.name, province: b.province, address: b.address }, karachiNow().date);
    const last = await prisma.invoice.findFirst({
      where: { businessId: b.id, environment: 'SANDBOX', scenarioId: id },
      orderBy: { createdAt: 'desc' },
      include: { items: { orderBy: { lineNo: 'asc' } } },
    });
    return {
      scenarioId: id,
      title: t.title,
      label: t.label,
      source: t.source,
      original: { raw: t.rawText, json: t.json, anomalies: t.anomalies },
      prepared: prep.prepared,
      changes: prep.changes,
      warnings: prep.warnings,
      latestInvoice: last ? invoiceDto(last) : null,
    };
  });

  /** Validate JSON shape and return the exact canonical request (no persistence, no FBR call). */
  app.post('/sandbox/preview', async (req) => {
    const body = z.object({ scenarioId: z.string().regex(/^SN\d{3}$/), payload: z.unknown() }).parse(req.body);
    const { input, issues, stripped } = jsonToInvoiceInput(body.payload, body.scenarioId);
    const b = await prisma.business.findUniqueOrThrow({ where: { id: req.auth!.businessId! } });
    let canonical: string | null = null;
    if (input) {
      const header = { ...input, invoiceDate: input.invoiceDate, sellerNtnCnic: b.ntnCnic, sellerBusinessName: b.name, sellerProvince: b.province, sellerAddress: b.address, buyerNtnCnic: input.buyerNtnCnic ?? '', invoiceRefNo: input.invoiceRefNo ?? '', scenarioId: body.scenarioId };
      const rows = input.items.map((it, i) => ({
        lineNo: i + 1,
        ...it,
        quantity: it.quantity ?? '0',
        totalValues: it.totalValues ?? '0',
        valueSalesExcludingST: it.valueSalesExcludingST ?? '0',
        fixedNotifiedValueOrRetailPrice: it.fixedNotifiedValueOrRetailPrice ?? '0',
        salesTaxApplicable: it.salesTaxApplicable ?? '0',
        salesTaxWithheldAtSource: it.salesTaxWithheldAtSource ?? '0',
        extraTax: it.extraTax ?? '0',
        furtherTax: it.furtherTax ?? '0',
        fedPayable: it.fedPayable ?? '0',
        discount: it.discount ?? '0',
      }));
      try {
        canonical = serializePayload(buildPayload(toPayloadInvoice(header as never, rows as never), 'SANDBOX'));
      } catch {
        canonical = null;
      }
    }
    return { issues, stripped, canonical, sellerFromProfile: { sellerNTNCNIC: b.ntnCnic, sellerBusinessName: b.name, sellerProvince: b.province, sellerAddress: b.address } };
  });

  /**
   * Save the edited scenario as a SANDBOX invoice (manual values preserved; seller always from
   * the business profile). Validation/submission then use the normal invoice endpoints, which
   * always target the sandbox URLs for SANDBOX invoices.
   */
  app.post('/sandbox/run', { preHandler: requireMember('invoice.write') }, async (req, reply) => {
    const body = z.object({ scenarioId: z.string().regex(/^SN\d{3}$/), payload: z.unknown(), invoiceId: z.string().optional().nullable() }).parse(req.body);
    const def = await prisma.scenarioDefinition.findUnique({ where: { id: body.scenarioId } });
    if (!def) throw notFound('Scenario');
    const { input, issues } = jsonToInvoiceInput(body.payload, body.scenarioId);
    const errors = issues.filter((i) => i.level === 'error');
    if (!input || errors.length) throw new AppError(422, 'SCHEMA_INVALID', errors.find((e) => e.field === 'invoiceDate')?.message ?? 'Fix the highlighted JSON/schema errors first', { issues });
    const ctx = ctxOf(req);
    const t = await prisma.scenarioTemplate.findUnique({ where: { scenarioId: body.scenarioId } });
    let result;
    if (body.invoiceId) {
      const existing = await getInvoice(ctx, body.invoiceId);
      if (existing.environment !== 'SANDBOX' || existing.scenarioId !== body.scenarioId) throw new AppError(409, 'WRONG_INVOICE', 'That invoice does not belong to this sandbox scenario');
      if (existing.status === 'RECONCILIATION_REQUIRED') throw new AppError(409, 'RECONCILIATION_REQUIRED', 'The last submission for this scenario is uncertain. Reconcile it first.');
      if (existing.status === 'ACCEPTED') {
        result = await createInvoice(ctx, input, { environment: 'SANDBOX', source: 'SANDBOX_WORKSPACE', rawTemplateDiff: { templateLabel: t?.label } });
      } else {
        result = await updateInvoice(ctx, existing.id, input);
      }
    } else {
      result = await createInvoice(ctx, input, { environment: 'SANDBOX', source: 'SANDBOX_WORKSPACE', rawTemplateDiff: { templateLabel: t?.label } });
    }
    await audit(req, { action: 'sandbox.save', entityType: 'Invoice', entityId: result.invoice.id, metadata: { scenarioId: body.scenarioId } });
    return reply.status(200).send({ invoice: invoiceDto(result.invoice), issues: [...issues, ...result.issues] });
  });

  app.get('/sandbox/scenarios/:id/attempts', async (req) => {
    const { id } = req.params as { id: string };
    const rows = await prisma.fbrAttempt.findMany({
      where: { businessId: req.auth!.businessId!, scenarioId: id, environment: 'SANDBOX', operation: { in: ['VALIDATE', 'POST'] } },
      orderBy: { startedAt: 'desc' },
      take: 50,
      include: { invoice: { select: { internalNumber: true, status: true } } },
    });
    return Promise.all(
      rows.map(async (a) => ({
        id: a.id,
        operation: a.operation,
        invoiceId: a.invoiceId,
        internalNumber: a.invoice?.internalNumber,
        httpStatus: a.httpStatus,
        outcome: a.outcome,
        fbrInvoiceNo: a.fbrInvoiceNo,
        startedAt: a.startedAt,
        durationMs: a.durationMs,
        requestBody: a.requestBody,
        responseBody: a.responseBody,
        issues: await explainIssues((a.errors as never) ?? []),
      })),
    );
  });
}
