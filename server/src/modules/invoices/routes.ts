import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../db.js';
import { audit } from '../../lib/audit.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { enumFilter, isoDateParam, paging, sortBy } from '../../lib/listing.js';
import { InvoiceStatus } from '@prisma/client';
import { isoToDateOnly, karachiNow } from '../../lib/time.js';
import { requireBusiness, requireMember } from '../../plugins/auth.js';
import { explainIssues } from '../../fbr/explain.js';
import { computeItem, discrepancies, invoiceTotals } from '../../fbr/calc.js';
import { invoiceInputSchema, itemInputSchema } from './schema.js';
import {
  checkBuyer, checkBuyerWithStatus,
  createInvoice,
  deleteInvoice,
  duplicateInvoice,
  getInvoice,
  invoiceDto,
  payloadTextFor,
  reconcileAccepted,
  reconcileNotRecorded,
  submitToFbr,
  updateInvoice,
  validateWithFbr,
  type Ctx,
} from './service.js';
import { renderInvoicePdf } from './pdf.js';
import { qrSvg } from './qr.js';

const ctxOf = (req: { auth?: { businessId: string | null; user: { id: string } } }): Ctx => ({ businessId: req.auth!.businessId!, userId: req.auth!.user.id, kind: 'USER' });

export async function invoiceRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireBusiness);

  app.get('/invoices', async (req) => {
    const q = z
      .object({
        q: z.string().trim().max(100).default(''),
        environment: z.enum(['SANDBOX', 'PRODUCTION', '']).default(''),
        status: enumFilter(Object.values(InvoiceStatus), true),
        type: z.enum(['SALE_INVOICE', 'DEBIT_NOTE', '']).default(''),
        from: isoDateParam,
        to: isoDateParam,
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(20),
        sort: z.string().optional(),
        dir: z.enum(['asc', 'desc']).default('desc'),
      })
      .parse(req.query);
    const where: Prisma.InvoiceWhereInput = {
      businessId: req.auth!.businessId!,
      ...(q.environment ? { environment: q.environment } : {}),
      ...(q.status ? { status: { in: q.status.split(',') as never } } : {}),
      ...(q.type ? { invoiceType: q.type } : {}),
      ...(q.from || q.to ? { invoiceDate: { ...(q.from ? { gte: isoToDateOnly(q.from) } : {}), ...(q.to ? { lte: isoToDateOnly(q.to) } : {}) } } : {}),
      ...(q.q
        ? { OR: [{ internalNumber: { contains: q.q, mode: 'insensitive' } }, { fbrInvoiceNumber: { contains: q.q } }, { buyerBusinessName: { contains: q.q, mode: 'insensitive' } }, { buyerNtnCnic: { contains: q.q } }] }
        : {}),
    };
    const [total, rows] = await Promise.all([
      prisma.invoice.count({ where }),
      prisma.invoice.findMany({
        where,
        orderBy: [sortBy(['invoiceDate', 'createdAt', 'grandTotal', 'internalNumber', 'status', 'buyerBusinessName'] as const, q.sort, q.dir, 'createdAt'), { createdAt: 'desc' }],
        ...paging(q.page, q.pageSize),
      }),
    ]);
    return {
      total,
      page: q.page,
      pageSize: q.pageSize,
      rows: rows.map((r) => ({
        id: r.id,
        internalNumber: r.internalNumber,
        environment: r.environment,
        invoiceType: r.invoiceType,
        invoiceDate: r.invoiceDate.toISOString().slice(0, 10),
        buyerBusinessName: r.buyerBusinessName,
        buyerNtnCnic: r.buyerNtnCnic,
        buyerRegistrationType: r.buyerRegistrationType,
        status: r.status,
        source: r.source,
        scenarioId: r.scenarioId,
        grandTotal: r.grandTotal.toString(),
        totalSalesTax: r.totalSalesTax.toString(),
        fbrInvoiceNumber: r.fbrInvoiceNumber,
        createdAt: r.createdAt,
      })),
    };
  });

  /** Calculation preview (no persistence). The UI uses this so totals always match the server. */
  app.post('/invoices/calc', async (req) => {
    const body = z.object({ autoCalc: z.boolean().default(true), items: z.array(itemInputSchema).max(500) }).parse(req.body);
    const lines = body.items.map((it, i) => {
      if (body.autoCalc) {
        const { values, issues } = computeItem({ ...it, quantity: it.quantity ?? 0, unitPrice: it.unitPrice ?? 0 });
        return {
          line: i + 1,
          values: {
            grossValue: values.grossValue.toFixed(2),
            valueSalesExcludingST: values.valueSalesExcludingST.toFixed(2),
            fixedNotifiedValueOrRetailPrice: values.fixedNotifiedValueOrRetailPrice.toFixed(2),
            salesTaxApplicable: values.salesTaxApplicable.toFixed(2),
            totalValues: values.totalValues.toFixed(2),
            rateKind: values.rate.kind,
          },
          issues,
        };
      }
      return { line: i + 1, values: null, issues: discrepancies({ ...it, quantity: it.quantity ?? 0, unitPrice: it.unitPrice ?? 0 }) };
    });
    const totals = invoiceTotals(
      body.items.map((it, i) => {
        const v = lines[i].values;
        return {
          valueSalesExcludingST: v?.valueSalesExcludingST ?? it.valueSalesExcludingST ?? 0,
          salesTaxApplicable: v?.salesTaxApplicable ?? it.salesTaxApplicable ?? 0,
          furtherTax: it.furtherTax ?? 0,
          extraTax: it.extraTax ?? 0,
          fedPayable: it.fedPayable ?? 0,
          salesTaxWithheldAtSource: it.salesTaxWithheldAtSource ?? 0,
          discount: it.discount ?? 0,
        };
      }),
    );
    return { lines, totals: Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, v.toFixed(2)])) };
  });

  /** Verify buyer registration before saving (Get_Reg_Type). */
  app.post('/invoices/buyer-check', { preHandler: requireMember('invoice.write') }, async (req) => {
    const body = z.object({ buyerNtnCnic: z.string().default(''), buyerBusinessName: z.string().default(''), buyerRegistrationType: z.enum(['REGISTERED', 'UNREGISTERED']).nullable(), invoiceDate: z.string().max(10).optional().nullable() }).parse(req.body);
    return checkBuyerWithStatus(ctxOf(req), body);
  });

  app.get('/invoices/:id', async (req) => {
    const inv = await getInvoice(ctxOf(req), (req.params as { id: string }).id);
    return invoiceDto(inv);
  });

  app.post('/invoices', { preHandler: requireMember('invoice.write') }, async (req, reply) => {
    const body = invoiceInputSchema.extend({ environment: z.enum(['SANDBOX', 'PRODUCTION']) }).parse(req.body);
    const { invoice, issues } = await createInvoice(ctxOf(req), body, { environment: body.environment });
    await audit(req, { action: 'invoice.create', entityType: 'Invoice', entityId: invoice.id, metadata: { environment: invoice.environment } });
    return reply.status(201).send({ invoice: invoiceDto(invoice), issues });
  });

  app.put('/invoices/:id', { preHandler: requireMember('invoice.write') }, async (req) => {
    const body = invoiceInputSchema.extend({ version: z.number().int().optional() }).parse(req.body);
    const { invoice, issues } = await updateInvoice(ctxOf(req), (req.params as { id: string }).id, body);
    await audit(req, { action: 'invoice.update', entityType: 'Invoice', entityId: invoice.id });
    return { invoice: invoiceDto(invoice), issues };
  });

  app.post('/invoices/:id/duplicate', { preHandler: requireMember('invoice.write') }, async (req, reply) => {
    const { invoice, issues } = await duplicateInvoice(ctxOf(req), (req.params as { id: string }).id);
    await audit(req, { action: 'invoice.duplicate', entityType: 'Invoice', entityId: invoice.id, metadata: { from: (req.params as { id: string }).id } });
    return reply.status(201).send({ invoice: invoiceDto(invoice), issues, note: `Date set to today (${karachiNow().date}) — invoices can only be created for the current month.` });
  });

  app.delete('/invoices/:id', { preHandler: requireMember('invoice.write') }, async (req) => {
    const inv = await deleteInvoice(ctxOf(req), (req.params as { id: string }).id);
    await audit(req, { action: 'invoice.delete', entityType: 'Invoice', entityId: inv.id, metadata: { internalNumber: inv.internalNumber } });
    return { ok: true };
  });

  app.get('/invoices/:id/payload', async (req) => {
    const inv = await getInvoice(ctxOf(req), (req.params as { id: string }).id);
    const accepted = inv.status === 'ACCEPTED' ? await prisma.invoiceSnapshot.findFirst({ where: { invoiceId: inv.id, kind: 'ACCEPTED' }, orderBy: { createdAt: 'desc' } }) : null;
    return { environment: inv.environment, payload: accepted?.payloadText ?? payloadTextFor(inv), source: accepted ? 'accepted snapshot' : 'current draft' };
  });

  app.post('/invoices/:id/validate', { preHandler: requireMember('invoice.submit'), config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) => {
    const r = await validateWithFbr(ctxOf(req), (req.params as { id: string }).id);
    await audit(req, { action: 'invoice.validate', entityType: 'Invoice', entityId: r.invoice.id, metadata: { outcome: r.outcome, attemptId: r.attemptId } });
    return { ...r, invoice: invoiceDto(r.invoice) };
  });

  app.post('/invoices/:id/submit', { preHandler: requireMember('invoice.submit'), config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) => {
    const r = await submitToFbr(ctxOf(req), (req.params as { id: string }).id);
    await audit(req, { action: 'invoice.submit', entityType: 'Invoice', entityId: r.invoice.id, metadata: { outcome: r.outcome, attemptId: r.attemptId, fbrInvoiceNumber: r.invoice.fbrInvoiceNumber } });
    return { ...r, invoice: invoiceDto(r.invoice) };
  });

  app.get('/invoices/:id/attempts', async (req) => {
    const inv = await getInvoice(ctxOf(req), (req.params as { id: string }).id);
    const rows = await prisma.fbrAttempt.findMany({ where: { invoiceId: inv.id, businessId: req.auth!.businessId! }, orderBy: { startedAt: 'desc' } });
    return Promise.all(
      rows.map(async (a) => ({
        id: a.id,
        operation: a.operation,
        environment: a.environment,
        url: a.url,
        httpStatus: a.httpStatus,
        outcome: a.outcome,
        fbrInvoiceNo: a.fbrInvoiceNo,
        startedAt: a.startedAt,
        finishedAt: a.finishedAt,
        durationMs: a.durationMs,
        requestBody: a.requestBody,
        responseBody: a.responseBody,
        errorMessage: a.errorMessage,
        issues: await explainIssues((a.errors as never) ?? []),
      })),
    );
  });

  app.post('/invoices/:id/reconcile', { preHandler: requireMember('invoice.submit') }, async (req) => {
    const body = z
      .discriminatedUnion('resolution', [
        z.object({ resolution: z.literal('ACCEPTED'), fbrInvoiceNumber: z.string().trim().min(10).max(40), note: z.string().trim().min(5).max(500) }),
        z.object({ resolution: z.literal('NOT_RECORDED'), note: z.string().trim().min(5).max(500) }),
      ])
      .parse(req.body);
    const id = (req.params as { id: string }).id;
    const inv =
      body.resolution === 'ACCEPTED' ? await reconcileAccepted(ctxOf(req), id, body.fbrInvoiceNumber, body.note) : await reconcileNotRecorded(ctxOf(req), id, body.note);
    await audit(req, { action: `invoice.reconcile.${body.resolution.toLowerCase()}`, entityType: 'Invoice', entityId: id, metadata: body });
    return invoiceDto(inv);
  });

  app.get('/invoices/:id/qr.svg', async (req, reply) => {
    const inv = await getInvoice(ctxOf(req), (req.params as { id: string }).id);
    if (inv.status !== 'ACCEPTED' || !inv.fbrInvoiceNumber) throw badRequest('A QR code is only available after FBR accepts the invoice');
    return reply.type('image/svg+xml').header('cache-control', 'private, max-age=3600').send(await qrSvg(inv.fbrInvoiceNumber));
  });

  app.get('/invoices/:id/pdf', async (req, reply) => {
    const inv = await getInvoice(ctxOf(req), (req.params as { id: string }).id);
    const business = await prisma.business.findUnique({ where: { id: req.auth!.businessId! } });
    if (!business) throw notFound('Business');
    const pdf = await renderInvoicePdf(inv, business);
    await audit(req, { action: 'invoice.pdf', entityType: 'Invoice', entityId: inv.id });
    return reply
      .type('application/pdf')
      .header('content-disposition', `attachment; filename="${inv.internalNumber}.pdf"`)
      .send(pdf);
  });
}
