import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import ExcelJS from 'exceljs';
import { Prisma } from '@prisma/client';
import { prisma } from '../../db.js';
import { isoToDateOnly, karachiNow } from '../../lib/time.js';
import { isoDateParam } from '../../lib/listing.js';
import { requireBusiness, requireMember } from '../../plugins/auth.js';
import { safeCell } from '../bulk/excel.js';
import { loadApplicability } from '../sandbox/routes.js';

const PERIOD_SQL = { daily: 'day', monthly: 'month', quarterly: 'quarter', yearly: 'year' } as const;

export async function reportRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireBusiness);

  app.get('/dashboard', async (req) => {
    const businessId = req.auth!.businessId!;
    const k = karachiNow();
    const monthWhere = { gte: isoToDateOnly(k.monthStart), lte: isoToDateOnly(k.monthEnd) };
    const prod = { businessId, environment: 'PRODUCTION' as const };
    const [total, sandboxTotal, monthCount, drafts, pending, accepted, failed, reconcile, acceptedAgg, monthAgg, recent, attempts, creds, b] = await Promise.all([
      prisma.invoice.count({ where: prod }),
      prisma.invoice.count({ where: { businessId, environment: 'SANDBOX' } }),
      prisma.invoice.count({ where: { ...prod, invoiceDate: monthWhere } }),
      prisma.invoice.count({ where: { ...prod, status: 'DRAFT' } }),
      prisma.invoice.count({ where: { ...prod, status: { in: ['VALIDATED', 'VALIDATING', 'SUBMITTING'] } } }),
      prisma.invoice.count({ where: { ...prod, status: 'ACCEPTED' } }),
      prisma.invoice.count({ where: { ...prod, status: { in: ['REJECTED', 'VALIDATION_FAILED'] } } }),
      prisma.invoice.count({ where: { businessId, status: 'RECONCILIATION_REQUIRED' } }),
      prisma.invoice.aggregate({ where: { ...prod, status: 'ACCEPTED' }, _sum: { totalValueExclST: true, totalSalesTax: true, totalFurtherTax: true, totalExtraTax: true, totalFed: true, totalWithheld: true, grandTotal: true } }),
      prisma.invoice.aggregate({ where: { ...prod, status: 'ACCEPTED', invoiceDate: monthWhere }, _sum: { totalValueExclST: true, totalSalesTax: true, totalFurtherTax: true, totalWithheld: true, grandTotal: true } }),
      prisma.invoice.findMany({ where: { businessId }, orderBy: { createdAt: 'desc' }, take: 8 }),
      prisma.fbrAttempt.findMany({ where: { businessId, operation: { in: ['VALIDATE', 'POST'] } }, orderBy: { startedAt: 'desc' }, take: 8, include: { invoice: { select: { internalNumber: true } } } }),
      prisma.fbrCredential.findMany({ where: { businessId } }),
      prisma.business.findUniqueOrThrow({ where: { id: businessId } }),
    ]);
    const { result, progress } = await loadApplicability(businessId);
    const passed = result.required.filter((id) => progress.find((p) => p.scenarioId === id)?.status === 'PASSED');
    const sum = (v: Prisma.Decimal | null | undefined) => (v ?? new Prisma.Decimal(0)).toFixed(2);
    return {
      today: k,
      counts: { totalProduction: total, sandboxTotal, currentMonth: monthCount, drafts, pending, accepted, failed, reconciliation: reconcile },
      production: {
        allTime: { valueExclST: sum(acceptedAgg._sum.totalValueExclST), salesTax: sum(acceptedAgg._sum.totalSalesTax), furtherTax: sum(acceptedAgg._sum.totalFurtherTax), extraTax: sum(acceptedAgg._sum.totalExtraTax), fed: sum(acceptedAgg._sum.totalFed), withheld: sum(acceptedAgg._sum.totalWithheld), grandTotal: sum(acceptedAgg._sum.grandTotal) },
        currentMonth: { valueExclST: sum(monthAgg._sum.totalValueExclST), salesTax: sum(monthAgg._sum.totalSalesTax), furtherTax: sum(monthAgg._sum.totalFurtherTax), withheld: sum(monthAgg._sum.totalWithheld), grandTotal: sum(monthAgg._sum.grandTotal) },
      },
      recentInvoices: recent.map((r) => ({ id: r.id, internalNumber: r.internalNumber, environment: r.environment, buyerBusinessName: r.buyerBusinessName, invoiceDate: r.invoiceDate.toISOString().slice(0, 10), status: r.status, grandTotal: r.grandTotal.toString(), fbrInvoiceNumber: r.fbrInvoiceNumber })),
      recentAttempts: attempts.map((a) => ({ id: a.id, operation: a.operation, environment: a.environment, outcome: a.outcome, httpStatus: a.httpStatus, startedAt: a.startedAt, internalNumber: a.invoice?.internalNumber, invoiceId: a.invoiceId, fbrInvoiceNo: a.fbrInvoiceNo })),
      integration: {
        productionEnabled: b.productionEnabled,
        sandbox: creds.find((c) => c.environment === 'SANDBOX') ? { status: creds.find((c) => c.environment === 'SANDBOX')!.status, lastCheckedAt: creds.find((c) => c.environment === 'SANDBOX')!.lastCheckedAt, tokenSaved: !!creds.find((c) => c.environment === 'SANDBOX')!.tokenEnc } : null,
        production: creds.find((c) => c.environment === 'PRODUCTION') ? { status: creds.find((c) => c.environment === 'PRODUCTION')!.status, lastCheckedAt: creds.find((c) => c.environment === 'PRODUCTION')!.lastCheckedAt, tokenSaved: !!creds.find((c) => c.environment === 'PRODUCTION')!.tokenEnc } : null,
      },
      scenarios: { required: result.required.length, passed: passed.length, remaining: result.required.filter((x) => !passed.includes(x)) },
    };
  });

  const reportQuery = z.object({
    period: z.enum(['daily', 'monthly', 'quarterly', 'yearly']).default('monthly'),
    environment: z.enum(['PRODUCTION', 'SANDBOX']).default('PRODUCTION'),
    status: z.enum(['ACCEPTED', 'ALL']).default('ACCEPTED'),
    from: isoDateParam,
    to: isoDateParam,
  });

  app.get('/reports/summary', { preHandler: requireMember('reports') }, async (req) => {
    const q = reportQuery.parse(req.query);
    const k = karachiNow();
    const from = q.from ?? `${k.year - 1}-01-01`;
    const to = q.to ?? k.monthEnd;
    const unit = PERIOD_SQL[q.period];
    const statusSql = q.status === 'ACCEPTED' ? Prisma.sql`AND status = 'ACCEPTED'` : Prisma.empty;
    const rows = await prisma.$queryRaw<{ period: Date; invoiceType: string; count: bigint; value: string; tax: string; further: string; extra: string; fed: string; withheld: string; total: string }[]>`
      SELECT date_trunc(${unit}, "invoiceDate") AS period, "invoiceType"::text AS "invoiceType", count(*) AS count,
        sum("totalValueExclST")::text AS value, sum("totalSalesTax")::text AS tax, sum("totalFurtherTax")::text AS further,
        sum("totalExtraTax")::text AS extra, sum("totalFed")::text AS fed, sum("totalWithheld")::text AS withheld, sum("grandTotal")::text AS total
      FROM "Invoice"
      WHERE "businessId" = ${req.auth!.businessId!} AND environment = ${q.environment}::"FbrEnvironment"
        AND "invoiceDate" BETWEEN ${isoToDateOnly(from)} AND ${isoToDateOnly(to)} ${statusSql}
      GROUP BY 1, 2 ORDER BY 1 ASC`;
    const byRate = await prisma.$queryRaw<{ rate: string; count: bigint; value: string; tax: string }[]>`
      SELECT i.rate, count(*) AS count, sum(i."valueSalesExcludingST")::text AS value, sum(i."salesTaxApplicable")::text AS tax
      FROM "InvoiceItem" i JOIN "Invoice" v ON v.id = i."invoiceId"
      WHERE v."businessId" = ${req.auth!.businessId!} AND v.environment = ${q.environment}::"FbrEnvironment"
        AND v."invoiceDate" BETWEEN ${isoToDateOnly(from)} AND ${isoToDateOnly(to)} ${q.status === 'ACCEPTED' ? Prisma.sql`AND v.status = 'ACCEPTED'` : Prisma.empty}
      GROUP BY 1 ORDER BY 3 DESC`;
    return {
      query: { ...q, from, to },
      note: q.environment === 'SANDBOX' ? 'Sandbox test values — not production sales' : "Your business's invoice sales values (not InvoiceGO revenue)",
      rows: rows.map((r) => ({ period: r.period.toISOString().slice(0, 10), invoiceType: r.invoiceType === 'DEBIT_NOTE' ? 'Debit Note' : 'Sale Invoice', count: Number(r.count), value: r.value, tax: r.tax, further: r.further, extra: r.extra, fed: r.fed, withheld: r.withheld, total: r.total })),
      byRate: byRate.map((r) => ({ rate: r.rate, count: Number(r.count), value: r.value, tax: r.tax })),
    };
  });

  app.get('/reports/invoices.xlsx', { preHandler: requireMember('reports') }, async (req, reply) => {
    const q = reportQuery.parse(req.query);
    const k = karachiNow();
    const rows = await prisma.invoice.findMany({
      where: {
        businessId: req.auth!.businessId!,
        environment: q.environment,
        ...(q.status === 'ACCEPTED' ? { status: 'ACCEPTED' } : {}),
        invoiceDate: { gte: isoToDateOnly(q.from ?? `${k.year}-01-01`), lte: isoToDateOnly(q.to ?? k.monthEnd) },
      },
      orderBy: { invoiceDate: 'asc' },
      take: 50000,
    });
    const wb = new ExcelJS.Workbook();
    const s = wb.addWorksheet(q.environment === 'SANDBOX' ? 'Sandbox invoices' : 'Invoices');
    s.columns = ['Internal no', 'FBR invoice no', 'Type', 'Date', 'Buyer', 'Buyer NTN/CNIC', 'Buyer type', 'Status', 'Value excl. ST', 'Sales tax', 'Further tax', 'Extra tax', 'FED', 'ST withheld', 'Grand total'].map((h) => ({ header: h, width: 18 }));
    s.getRow(1).font = { bold: true };
    for (const r of rows) {
      s.addRow([safeCell(r.internalNumber), safeCell(r.fbrInvoiceNumber ?? ''), r.invoiceType === 'DEBIT_NOTE' ? 'Debit Note' : 'Sale Invoice', r.invoiceDate.toISOString().slice(0, 10), safeCell(r.buyerBusinessName), safeCell(r.buyerNtnCnic), r.buyerRegistrationType ?? '', r.status, Number(r.totalValueExclST), Number(r.totalSalesTax), Number(r.totalFurtherTax), Number(r.totalExtraTax), Number(r.totalFed), Number(r.totalWithheld), Number(r.grandTotal)]);
    }
    for (const c of [9, 10, 11, 12, 13, 14, 15]) s.getColumn(c).numFmt = '#,##0.00';
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    return reply.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').header('content-disposition', `attachment; filename="invoicego-${q.environment.toLowerCase()}-invoices.xlsx"`).send(buf);
  });
}
