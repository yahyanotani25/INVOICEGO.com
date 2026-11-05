import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import ExcelJS from 'exceljs';
import { AttemptOperation, AttemptOutcome, InvoiceStatus, Prisma, TicketStatus, UserStatus } from '@prisma/client';
import { prisma } from '../../db.js';
import { config } from '../../config.js';
import { maskLast4 } from '../../lib/crypto.js';
import { audit } from '../../lib/audit.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { enumFilter, paging } from '../../lib/listing.js';
import { zTrim } from '../../lib/validators.js';
import { requireAdmin, requireAdminPerm } from '../../plugins/auth.js';
import { explainIssues } from '../../fbr/explain.js';
import { publicGetJson } from '../../fbr/http.js';
import { invoiceDto, submitToFbr } from '../invoices/service.js';
import { sendPasswordReset } from '../auth/routes.js';
import { ticketDto } from '../support/routes.js';
import { notifyUser } from '../notifications/notify.js';
import { safeCell } from '../bulk/excel.js';
import { enqueue, registerJob } from '../../jobs/runner.js';
import { adminAuthRoutes } from './auth.js';
import { createAdminInvite } from './invite.js';
import { runBackup } from './backup.js';

const SETTINGS_KEYS = ['platform', 'email', 'api', 'invoice', 'backup'] as const;
const settingSchemas: Record<(typeof SETTINGS_KEYS)[number], z.ZodTypeAny> = {
  platform: z.object({ softwareName: zTrim(100), companyName: zTrim(200), companyAddress: zTrim(300).optional().default(''), supportEmail: z.string().email().or(z.literal('')).optional().default(''), supportPhone: zTrim(40).optional().default(''), logoText: zTrim(40).optional().default('') }),
  email: z.object({ fromName: zTrim(100), replyTo: z.string().email().or(z.literal('')).optional().default('') }),
  api: z.object({ connectTimeoutMs: z.number().int().min(1000).max(60000), responseTimeoutMs: z.number().int().min(5000).max(180000), note: zTrim(500).optional().default('') }),
  invoice: z.object({ defaultPrefix: z.string().regex(/^[A-Za-z0-9-]{1,10}$/), printFooter: zTrim(300).optional().default('') }),
  backup: z.object({ retentionDays: z.number().int().min(1).max(3650), scheduleNote: zTrim(300).optional().default('') }),
};

registerJob('backup.run', async (job) => {
  await runBackup(job.createdById);
});

export async function adminRoutes(app: FastifyInstance) {
  await app.register(adminAuthRoutes);

  await app.register(async (r) => {
    r.addHook('preHandler', requireAdmin);

    // ------------------------------------------------------------ dashboard (no subscription/payment stats)
    r.get('/dashboard', async () => {
      const userWhere = { platformRole: 'NONE' as const, deletedAt: null };
      const [users, active, suspended, blocked, inactive, pendingVerification, invProd, invSandbox, accepted, failed, pending, reconcile, recent] = await Promise.all([
        prisma.user.count({ where: userWhere }),
        prisma.user.count({ where: { ...userWhere, status: 'ACTIVE' } }),
        prisma.user.count({ where: { ...userWhere, status: 'SUSPENDED' } }),
        prisma.user.count({ where: { ...userWhere, status: 'BLOCKED' } }),
        prisma.user.count({ where: { ...userWhere, status: 'INACTIVE' } }),
        prisma.user.count({ where: { ...userWhere, status: 'PENDING_VERIFICATION' } }),
        prisma.invoice.count({ where: { environment: 'PRODUCTION' } }),
        prisma.invoice.count({ where: { environment: 'SANDBOX' } }),
        prisma.invoice.count({ where: { environment: 'PRODUCTION', status: 'ACCEPTED' } }),
        prisma.invoice.count({ where: { environment: 'PRODUCTION', status: { in: ['REJECTED', 'VALIDATION_FAILED'] } } }),
        prisma.invoice.count({ where: { environment: 'PRODUCTION', status: { in: ['DRAFT', 'VALIDATED', 'VALIDATING', 'SUBMITTING'] } } }),
        prisma.invoice.count({ where: { status: 'RECONCILIATION_REQUIRED' } }),
        prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 15 }),
      ]);
      return {
        users: { total: users, active, suspended, blocked, inactive, pendingVerification },
        invoices: { production: invProd, sandbox: invSandbox, accepted, failed, pending, reconciliation: reconcile },
        recentActivity: recent,
      };
    });

    // ------------------------------------------------------------ users
    r.get('/users', { preHandler: requireAdminPerm('users.read') }, async (req) => {
      const q = z.object({ q: z.string().trim().max(100).default(''), status: enumFilter(Object.values(UserStatus)), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25) }).parse(req.query);
      const where: Prisma.UserWhereInput = {
        platformRole: 'NONE',
        ...(q.status ? { status: q.status as never } : { status: { not: 'DELETED' } }),
        ...(q.q
          ? { OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { email: { contains: q.q, mode: 'insensitive' } }, { phone: { contains: q.q } }, { memberships: { some: { business: { OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { ntnCnic: { contains: q.q } }, { strn: { contains: q.q } }] } } } }] }
          : {}),
      };
      const [total, rows] = await Promise.all([
        prisma.user.count({ where }),
        prisma.user.findMany({ where, orderBy: { createdAt: 'desc' }, include: { memberships: { include: { business: true } } }, ...paging(q.page, q.pageSize) }),
      ]);
      return {
        total,
        rows: rows.map((u) => ({
          id: u.id,
          name: u.name,
          email: u.email,
          phone: u.phone,
          status: u.status,
          createdAt: u.createdAt,
          lastLoginAt: u.lastLoginAt,
          businesses: u.memberships.map((m) => ({ id: m.businessId, name: m.business.name, ntnCnic: m.business.ntnCnic, strn: m.business.strn, role: m.role })),
        })),
      };
    });

    r.get('/users/:id', { preHandler: requireAdminPerm('users.read') }, async (req) => {
      const { id } = req.params as { id: string };
      const u = await prisma.user.findFirst({ where: { id, platformRole: 'NONE' }, include: { memberships: { include: { business: { include: { credentials: true } } } } } });
      if (!u) throw notFound('User');
      const businessIds = u.memberships.map((m) => m.businessId);
      const [logins, invoiceStats] = await Promise.all([
        prisma.loginEvent.findMany({ where: { userId: id }, orderBy: { createdAt: 'desc' }, take: 20 }),
        prisma.invoice.groupBy({ by: ['environment', 'status'], where: { businessId: { in: businessIds } }, _count: true }),
      ]);
      await audit(req, { action: 'admin.user.view', entityType: 'User', entityId: id });
      return {
        id: u.id,
        name: u.name,
        email: u.email,
        phone: u.phone,
        status: u.status,
        statusReason: u.statusReason,
        emailVerifiedAt: u.emailVerifiedAt,
        createdAt: u.createdAt,
        lastLoginAt: u.lastLoginAt,
        businesses: u.memberships.map((m) => ({
          id: m.businessId,
          role: m.role,
          name: m.business.name,
          ntnCnic: m.business.ntnCnic,
          strn: m.business.strn,
          province: m.business.province,
          address: m.business.address,
          activities: m.business.businessActivities,
          sector: m.business.sector,
          productionEnabled: m.business.productionEnabled,
          // Never expose tenant tokens — status and the masked last 4 characters only.
          credentials: m.business.credentials.map((c) => ({ environment: c.environment, status: c.status, tokenMasked: maskLast4(c.tokenLast4), lastCheckedAt: c.lastCheckedAt })),
        })),
        logins,
        invoiceStats: invoiceStats.map((s) => ({ environment: s.environment, status: s.status, count: s._count })),
      };
    });

    r.post('/users/:id/status', { preHandler: requireAdminPerm('users.manage') }, async (req) => {
      const { id } = req.params as { id: string };
      const { status, reason } = z.object({ status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED', 'BLOCKED']), reason: zTrim(300).min(3) }).parse(req.body);
      const u = await prisma.user.findFirst({ where: { id, platformRole: 'NONE', status: { not: 'DELETED' } } });
      if (!u) throw notFound('User');
      await prisma.user.update({ where: { id }, data: { status, statusReason: reason } });
      if (status !== 'ACTIVE') await prisma.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      await audit(req, { action: 'admin.user.status', entityType: 'User', entityId: id, metadata: { from: u.status, to: status, reason } });
      return { ok: true };
    });

    r.post('/users/:id/password-reset', { preHandler: requireAdminPerm('users.manage') }, async (req) => {
      const { id } = req.params as { id: string };
      const u = await prisma.user.findFirst({ where: { id, platformRole: 'NONE', status: { notIn: ['DELETED'] } } });
      if (!u) throw notFound('User');
      await sendPasswordReset(req, u.id, u.email, req.auth!.user.id);
      await audit(req, { action: 'admin.user.password_reset', entityType: 'User', entityId: id });
      return { ok: true, message: `A password reset link was emailed to ${u.email}. The administrator never sees the password or the link.` };
    });

    /** Controlled deletion: personal data is anonymised; financial records and audit logs are retained. */
    r.post('/users/:id/delete', { preHandler: requireAdminPerm('users.delete') }, async (req) => {
      const { id } = req.params as { id: string };
      const { confirmEmail, reason } = z.object({ confirmEmail: z.string().trim().toLowerCase(), reason: zTrim(300).min(5) }).parse(req.body);
      const u = await prisma.user.findFirst({ where: { id, platformRole: 'NONE' } });
      if (!u || u.status === 'DELETED') throw notFound('User');
      if (u.email !== confirmEmail) throw badRequest('Type the user email exactly to confirm deletion');
      await prisma.$transaction([
        prisma.user.update({ where: { id }, data: { status: 'DELETED', deletedAt: new Date(), name: 'Deleted user', email: `deleted+${id}@invalid.invoicego`, phone: null, passwordHash: null, totpSecretEnc: null, statusReason: reason } }),
        prisma.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } }),
      ]);
      await audit(req, { action: 'admin.user.delete', entityType: 'User', entityId: id, metadata: { reason, retained: 'businesses, invoices, FBR attempts and audit logs are retained for financial-record compliance' } });
      return { ok: true };
    });

    // ------------------------------------------------------------ invoice oversight
    r.get('/invoices', { preHandler: requireAdminPerm('invoices.read') }, async (req) => {
      const q = z.object({ q: z.string().trim().max(100).default(''), status: enumFilter(Object.values(InvoiceStatus), true), environment: z.enum(['SANDBOX', 'PRODUCTION', '']).default(''), businessId: z.string().default(''), page: z.coerce.number().int().min(1).default(1) }).parse(req.query);
      const where: Prisma.InvoiceWhereInput = {
        ...(q.environment ? { environment: q.environment } : {}),
        ...(q.status ? { status: { in: q.status.split(',') as never } } : {}),
        ...(q.businessId ? { businessId: q.businessId } : {}),
        ...(q.q ? { OR: [{ internalNumber: { contains: q.q, mode: 'insensitive' } }, { fbrInvoiceNumber: { contains: q.q } }, { buyerBusinessName: { contains: q.q, mode: 'insensitive' } }, { business: { name: { contains: q.q, mode: 'insensitive' } } }] } : {}),
      };
      const [total, rows] = await Promise.all([
        prisma.invoice.count({ where }),
        prisma.invoice.findMany({ where, orderBy: { createdAt: 'desc' }, include: { business: { select: { name: true, ntnCnic: true } } }, ...paging(q.page, 25) }),
      ]);
      await audit(req, { action: 'admin.invoices.list', metadata: { filters: q } });
      return {
        total,
        rows: rows.map((i) => ({ id: i.id, internalNumber: i.internalNumber, business: i.business, businessId: i.businessId, customer: i.buyerBusinessName, amount: i.grandTotal.toString(), invoiceDate: i.invoiceDate.toISOString().slice(0, 10), environment: i.environment, status: i.status, fbrInvoiceNumber: i.fbrInvoiceNumber, createdAt: i.createdAt })),
      };
    });

    r.get('/invoices/:id', { preHandler: requireAdminPerm('invoices.read') }, async (req) => {
      const { id } = req.params as { id: string };
      const inv = await prisma.invoice.findUnique({ where: { id }, include: { items: { orderBy: { lineNo: 'asc' } }, business: { select: { name: true, ntnCnic: true } } } });
      if (!inv) throw notFound('Invoice');
      const attempts = await prisma.fbrAttempt.findMany({ where: { invoiceId: id }, orderBy: { startedAt: 'desc' } });
      await audit(req, { action: 'admin.invoice.view', entityType: 'Invoice', entityId: id, businessId: inv.businessId });
      return {
        business: inv.business,
        invoice: invoiceDto(inv),
        attempts: await Promise.all(attempts.map(async (a) => ({ id: a.id, operation: a.operation, url: a.url, httpStatus: a.httpStatus, outcome: a.outcome, fbrInvoiceNo: a.fbrInvoiceNo, startedAt: a.startedAt, durationMs: a.durationMs, initiatedKind: a.initiatedKind, requestBody: a.requestBody, responseBody: a.responseBody, issues: await explainIssues((a.errors as never) ?? []) }))),
      };
    });

    /**
     * Controlled retry: only for invoices whose last submission definitely did not reach FBR
     * (status VALIDATED after NOT_SENT / 401 / 4xx). Uncertain outcomes must be reconciled by the
     * business against IRIS first. The current-month rule is re-applied by submitToFbr.
     */
    r.post('/invoices/:id/retry', { preHandler: requireAdminPerm('fbr.retry') }, async (req) => {
      const { id } = req.params as { id: string };
      const { reason } = z.object({ reason: zTrim(300).min(5) }).parse(req.body);
      const inv = await prisma.invoice.findUnique({ where: { id } });
      if (!inv) throw notFound('Invoice');
      if (inv.status !== 'VALIDATED') throw conflict('Retry is only allowed for validated invoices whose previous attempt was not delivered to FBR. Uncertain outcomes must be reconciled first.');
      const lastPost = await prisma.fbrAttempt.findFirst({ where: { invoiceId: id, operation: 'POST' }, orderBy: { startedAt: 'desc' } });
      const r2 = await submitToFbr({ businessId: inv.businessId, userId: req.auth!.user.id, kind: 'ADMIN' }, id, { retryOfId: lastPost?.id });
      await audit(req, { action: 'admin.invoice.retry', entityType: 'Invoice', entityId: id, businessId: inv.businessId, metadata: { reason, outcome: r2.outcome, attemptId: r2.attemptId } });
      return { outcome: r2.outcome, status: r2.invoice.status, issues: r2.issues };
    });

    // ------------------------------------------------------------ FBR / PRAL monitoring
    r.get('/fbr/overview', { preHandler: requireAdminPerm('fbr.read') }, async () => {
      const since24 = new Date(Date.now() - 24 * 3600_000);
      const since30d = new Date(Date.now() - 30 * 24 * 3600_000);
      const [creds, byOutcome, byHttp, failures, reconcileQueue, usage] = await Promise.all([
        prisma.fbrCredential.findMany({ include: { business: { select: { name: true, productionEnabled: true } } }, orderBy: { updatedAt: 'desc' }, take: 200 }),
        prisma.fbrAttempt.groupBy({ by: ['operation', 'outcome'], where: { startedAt: { gte: since24 } }, _count: true }),
        prisma.fbrAttempt.groupBy({ by: ['httpStatus'], where: { startedAt: { gte: since30d } }, _count: true }),
        prisma.fbrAttempt.findMany({ where: { outcome: { in: ['INVALID', 'AUTH_ERROR', 'HTTP_ERROR', 'NOT_SENT', 'UNCERTAIN', 'BAD_RESPONSE'] }, operation: { in: ['POST', 'VALIDATE'] } }, orderBy: { startedAt: 'desc' }, take: 25, include: { invoice: { select: { internalNumber: true, status: true } } } }),
        prisma.invoice.findMany({ where: { status: 'RECONCILIATION_REQUIRED' }, include: { business: { select: { name: true } } }, orderBy: { updatedAt: 'desc' }, take: 50 }),
        prisma.$queryRaw<{ day: Date; operation: string; count: bigint }[]>`SELECT date_trunc('day', (("startedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Karachi')) AS day, operation::text AS operation, count(*) AS count FROM "FbrAttempt" WHERE "startedAt" >= ${since30d} GROUP BY 1, 2 ORDER BY 1`,
      ]);
      const fbrCodes = await prisma.$queryRaw<{ code: string; count: bigint }[]>`SELECT e->>'code' AS code, count(*) AS count FROM "FbrAttempt", jsonb_array_elements(COALESCE(errors, '[]'::jsonb)) e WHERE "startedAt" >= ${since30d} AND e->>'code' IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 20`;
      return {
        credentials: creds.map((c) => ({ businessId: c.businessId, business: c.business.name, environment: c.environment, status: c.status, tokenMasked: maskLast4(c.tokenLast4), lastCheckedAt: c.lastCheckedAt, lastCheckMessage: c.lastCheckMessage, productionEnabled: c.business.productionEnabled })),
        last24h: byOutcome.map((b) => ({ operation: b.operation, outcome: b.outcome, count: b._count })),
        httpStatus30d: byHttp.map((b) => ({ httpStatus: b.httpStatus, count: b._count })),
        fbrErrorCodes30d: fbrCodes.map((c) => ({ code: c.code, count: Number(c.count) })),
        recentFailures: failures.map((f) => ({ id: f.id, businessId: f.businessId, invoiceId: f.invoiceId, internalNumber: f.invoice?.internalNumber, invoiceStatus: f.invoice?.status, operation: f.operation, environment: f.environment, outcome: f.outcome, httpStatus: f.httpStatus, startedAt: f.startedAt, errors: f.errors })),
        reconciliationQueue: reconcileQueue.map((i) => ({ id: i.id, business: i.business.name, internalNumber: i.internalNumber, environment: i.environment, note: i.reconciliationNote, updatedAt: i.updatedAt })),
        usage30d: usage.map((u) => ({ day: u.day.toISOString().slice(0, 10), operation: u.operation, count: Number(u.count) })),
        server: { configuredOutboundIps: config.OUTBOUND_IPS.split(',').map((s) => s.trim()).filter(Boolean), hostingCompany: config.HOSTING_COMPANY, hostingCountry: config.HOSTING_COUNTRY },
      };
    });

    /** Detects the current public egress IP (what FBR sees) via api.ipify.org. Informational only. */
    r.post('/fbr/detect-ip', { preHandler: requireAdminPerm('fbr.read') }, async (req) => {
      let ip: string | null = null;
      try {
        const j = (await publicGetJson('https://api.ipify.org?format=json')) as { ip?: string };
        ip = typeof j.ip === 'string' ? j.ip : null;
      } catch {
        ip = null;
      }
      await audit(req, { action: 'admin.fbr.detect_ip', metadata: { ip } });
      return { detectedIp: ip, note: 'Detected from this server at request time. Whitelist only static IPs you control.' };
    });

    r.get('/fbr/attempts', { preHandler: requireAdminPerm('fbr.read') }, async (req) => {
      const q = z.object({ outcome: enumFilter(Object.values(AttemptOutcome)), operation: enumFilter(Object.values(AttemptOperation)), environment: z.enum(['SANDBOX', 'PRODUCTION', '']).default(''), page: z.coerce.number().int().min(1).default(1) }).parse(req.query);
      const where: Prisma.FbrAttemptWhereInput = {
        ...(q.outcome ? { outcome: q.outcome as never } : {}),
        ...(q.operation ? { operation: q.operation as never } : {}),
        ...(q.environment ? { environment: q.environment } : {}),
      };
      const [total, rows] = await Promise.all([prisma.fbrAttempt.count({ where }), prisma.fbrAttempt.findMany({ where, orderBy: { startedAt: 'desc' }, ...paging(q.page, 50), include: { invoice: { select: { internalNumber: true } } } })]);
      // Tokens are never stored in attempts; bodies are shown to authorised administrators only.
      return { total, rows: rows.map((a) => ({ id: a.id, businessId: a.businessId, invoiceId: a.invoiceId, internalNumber: a.invoice?.internalNumber, operation: a.operation, environment: a.environment, url: a.url, httpStatus: a.httpStatus, outcome: a.outcome, durationMs: a.durationMs, startedAt: a.startedAt, errors: a.errors, errorMessage: a.errorMessage })) };
    });

    // ------------------------------------------------------------ reports
    r.get('/reports/summary', { preHandler: requireAdminPerm('reports.read') }, async () => {
      const regDaily = await prisma.$queryRaw<{ day: Date; count: bigint }[]>`SELECT date_trunc('day', (("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Karachi')) AS day, count(*) AS count FROM "User" WHERE "platformRole" = 'NONE' AND "createdAt" >= now() - interval '90 days' GROUP BY 1 ORDER BY 1`;
      const regMonthly = await prisma.$queryRaw<{ month: Date; count: bigint }[]>`SELECT date_trunc('month', (("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Karachi')) AS month, count(*) AS count FROM "User" WHERE "platformRole" = 'NONE' AND "createdAt" >= now() - interval '24 months' GROUP BY 1 ORDER BY 1`;
      const fbrMonthly = await prisma.$queryRaw<{ month: Date; status: string; count: bigint }[]>`SELECT date_trunc('month', "invoiceDate") AS month, status::text AS status, count(*) AS count FROM "Invoice" WHERE environment = 'PRODUCTION' AND status IN ('ACCEPTED','REJECTED','VALIDATION_FAILED','RECONCILIATION_REQUIRED') GROUP BY 1, 2 ORDER BY 1`;
      const userwise = await prisma.$queryRaw<{ businessId: string; name: string; ntn: string; invoices: bigint; accepted: bigint; failed: bigint; value: string | null }[]>`
        SELECT b.id AS "businessId", b.name, b."ntnCnic" AS ntn, count(i.id) AS invoices,
          count(i.id) FILTER (WHERE i.status = 'ACCEPTED') AS accepted,
          count(i.id) FILTER (WHERE i.status IN ('REJECTED','VALIDATION_FAILED')) AS failed,
          sum(i."grandTotal") FILTER (WHERE i.status = 'ACCEPTED')::text AS value
        FROM "Business" b LEFT JOIN "Invoice" i ON i."businessId" = b.id AND i.environment = 'PRODUCTION'
        GROUP BY b.id ORDER BY invoices DESC LIMIT 500`;
      const statusCounts = await prisma.user.groupBy({ by: ['status'], where: { platformRole: 'NONE' }, _count: true });
      return {
        note: 'Invoice values are the businesses\' own sales — not InvoiceGO revenue. Subscription and payment reporting is deferred (not in this release).',
        registrationsDaily: regDaily.map((x) => ({ day: x.day.toISOString().slice(0, 10), count: Number(x.count) })),
        registrationsMonthly: regMonthly.map((x) => ({ month: x.month.toISOString().slice(0, 7), count: Number(x.count) })),
        userStatus: statusCounts.map((s) => ({ status: s.status, count: s._count })),
        fbrMonthly: fbrMonthly.map((x) => ({ month: x.month.toISOString().slice(0, 7), status: x.status, count: Number(x.count) })),
        userwise: userwise.map((u) => ({ businessId: u.businessId, name: u.name, ntn: u.ntn, invoices: Number(u.invoices), accepted: Number(u.accepted), failed: Number(u.failed), salesValue: u.value ?? '0.00' })),
      };
    });

    r.get('/reports/export', { preHandler: requireAdminPerm('reports.read') }, async (req, reply) => {
      const { type, format } = z.object({ type: z.enum(['users', 'invoices', 'userwise']), format: z.enum(['csv', 'xlsx']).default('xlsx') }).parse(req.query);
      let header: string[] = [];
      let rows: (string | number)[][] = [];
      if (type === 'users') {
        const us = await prisma.user.findMany({ where: { platformRole: 'NONE' }, include: { memberships: { include: { business: true } } }, orderBy: { createdAt: 'asc' } });
        header = ['Name', 'Email', 'Phone', 'Status', 'Registered', 'Business', 'NTN/CNIC', 'STRN'];
        rows = us.map((u) => [u.name, u.email, u.phone ?? '', u.status, u.createdAt.toISOString().slice(0, 10), u.memberships[0]?.business.name ?? '', u.memberships[0]?.business.ntnCnic ?? '', u.memberships[0]?.business.strn ?? '']);
      } else if (type === 'invoices') {
        const inv = await prisma.invoice.findMany({ where: { environment: 'PRODUCTION' }, include: { business: { select: { name: true } } }, orderBy: { createdAt: 'asc' }, take: 100000 });
        header = ['Business', 'Internal no', 'FBR invoice no', 'Customer', 'Date', 'Status', 'Amount (PKR)'];
        rows = inv.map((i) => [i.business.name, i.internalNumber, i.fbrInvoiceNumber ?? '', i.buyerBusinessName, i.invoiceDate.toISOString().slice(0, 10), i.status, Number(i.grandTotal)]);
      } else {
        const u = await prisma.$queryRaw<{ name: string; ntn: string; invoices: bigint; accepted: bigint; failed: bigint; value: string | null }[]>`SELECT b.name, b."ntnCnic" AS ntn, count(i.id) AS invoices, count(i.id) FILTER (WHERE i.status='ACCEPTED') AS accepted, count(i.id) FILTER (WHERE i.status IN ('REJECTED','VALIDATION_FAILED')) AS failed, sum(i."grandTotal") FILTER (WHERE i.status='ACCEPTED')::text AS value FROM "Business" b LEFT JOIN "Invoice" i ON i."businessId"=b.id AND i.environment='PRODUCTION' GROUP BY b.id ORDER BY b.name`;
        header = ['Business', 'NTN/CNIC', 'Invoices', 'Accepted', 'Failed', 'Accepted sales value (PKR, business sales)'];
        rows = u.map((x) => [x.name, x.ntn, Number(x.invoices), Number(x.accepted), Number(x.failed), Number(x.value ?? 0)]);
      }
      await audit(req, { action: 'admin.report.export', metadata: { type, format, rows: rows.length } });
      const safeRows = rows.map((r2) => r2.map(safeCell));
      if (format === 'csv') {
        const esc = (v: string | number) => (typeof v === 'number' ? String(v) : `"${String(v).replace(/"/g, '""')}"`);
        const csv = [header.map(esc).join(','), ...safeRows.map((r2) => r2.map(esc).join(','))].join('\r\n');
        return reply.type('text/csv; charset=utf-8').header('content-disposition', `attachment; filename="invoicego-${type}.csv"`).send('﻿' + csv);
      }
      const wb = new ExcelJS.Workbook();
      const s = wb.addWorksheet(type);
      s.addRow(header).font = { bold: true };
      safeRows.forEach((r2) => s.addRow(r2));
      return reply.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').header('content-disposition', `attachment; filename="invoicego-${type}.xlsx"`).send(Buffer.from(await wb.xlsx.writeBuffer()));
    });

    // ------------------------------------------------------------ support
    r.get('/support', { preHandler: requireAdminPerm('support.read') }, async (req) => {
      const q = z.object({ status: enumFilter(Object.values(TicketStatus)), page: z.coerce.number().int().min(1).default(1) }).parse(req.query);
      const where: Prisma.SupportTicketWhereInput = q.status ? { status: q.status as never } : {};
      const [total, rows] = await Promise.all([prisma.supportTicket.count({ where }), prisma.supportTicket.findMany({ where, orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }], include: { user: { select: { name: true, email: true } } }, ...paging(q.page, 25) })]);
      return { total, rows: rows.map((t) => ({ ...ticketDto(t), user: t.user, businessId: t.businessId })) };
    });

    r.get('/support/:id', { preHandler: requireAdminPerm('support.read') }, async (req) => {
      const t = await prisma.supportTicket.findUnique({ where: { id: (req.params as { id: string }).id }, include: { messages: { orderBy: { createdAt: 'asc' } }, attachments: { select: { id: true, filename: true, size: true, createdAt: true } }, user: { select: { name: true, email: true } } } });
      if (!t) throw notFound('Ticket');
      const b = await prisma.business.findUnique({ where: { id: t.businessId }, select: { name: true, ntnCnic: true } });
      return { ...ticketDto(t), user: t.user, business: b };
    });

    r.post('/support/:id/reply', { preHandler: requireAdminPerm('support.reply') }, async (req) => {
      const { id } = req.params as { id: string };
      const body = z.object({ body: zTrim(5000).min(1), status: z.enum(['OPEN', 'IN_PROGRESS', 'AWAITING_USER', 'RESOLVED', 'CLOSED']).optional() }).parse(req.body);
      const t = await prisma.supportTicket.findUnique({ where: { id } });
      if (!t) throw notFound('Ticket');
      await prisma.ticketMessage.create({ data: { ticketId: id, authorId: req.auth!.user.id, authorIsAdmin: true, body: body.body } });
      await prisma.supportTicket.update({ where: { id }, data: { status: body.status ?? 'AWAITING_USER', closedAt: body.status === 'CLOSED' ? new Date() : null } });
      await notifyUser(t.userId, 'SUPPORT_REPLY', `Support replied to ticket #${t.number}`, body.body.slice(0, 200), `/app/support/${id}`);
      await audit(req, { action: 'admin.support.reply', entityType: 'SupportTicket', entityId: id, businessId: t.businessId });
      return { ok: true };
    });

    r.post('/support/:id/status', { preHandler: requireAdminPerm('support.reply') }, async (req) => {
      const { id } = req.params as { id: string };
      const { status, priority } = z.object({ status: z.enum(['OPEN', 'IN_PROGRESS', 'AWAITING_USER', 'RESOLVED', 'CLOSED']), priority: z.enum(['HIGH', 'NORMAL', 'LOW']).optional() }).parse(req.body);
      await prisma.supportTicket.update({ where: { id }, data: { status, ...(priority ? { priority } : {}), closedAt: status === 'CLOSED' ? new Date() : null } });
      await audit(req, { action: 'admin.support.status', entityType: 'SupportTicket', entityId: id, metadata: { status, priority } });
      return { ok: true };
    });

    r.get('/support/attachments/:id', { preHandler: requireAdminPerm('support.read') }, async (req, reply) => {
      const a = await prisma.ticketAttachment.findUnique({ where: { id: (req.params as { id: string }).id } });
      if (!a) throw notFound('Attachment');
      await audit(req, { action: 'admin.support.attachment.download', entityType: 'TicketAttachment', entityId: a.id });
      return reply.type('application/pdf').header('content-disposition', `attachment; filename="${a.filename}"`).header('x-content-type-options', 'nosniff').send(Buffer.from(a.data));
    });

    // ------------------------------------------------------------ notifications & announcements
    r.get('/notifications', async () => {
      const [items, unread] = await Promise.all([
        prisma.notification.findMany({ where: { audience: 'ADMINS' }, orderBy: { createdAt: 'desc' }, take: 100 }),
        prisma.notification.count({ where: { audience: 'ADMINS', readAt: null } }),
      ]);
      return { items, unread };
    });
    r.post('/notifications/read-all', async () => {
      await prisma.notification.updateMany({ where: { audience: 'ADMINS', readAt: null }, data: { readAt: new Date() } });
      return { ok: true };
    });

    r.get('/announcements', { preHandler: requireAdminPerm('notifications.manage') }, async () => prisma.announcement.findMany({ orderBy: { createdAt: 'desc' }, take: 100 }));
    r.post('/announcements', { preHandler: requireAdminPerm('notifications.manage') }, async (req) => {
      const body = z.object({ kind: z.enum(['ANNOUNCEMENT', 'MAINTENANCE']), title: zTrim(200).min(3), body: zTrim(3000).min(3), startsAt: z.string().datetime().optional(), endsAt: z.string().datetime().optional().nullable(), notifyUsers: z.boolean().default(false) }).parse(req.body);
      const a = await prisma.announcement.create({ data: { kind: body.kind, title: body.title, body: body.body, startsAt: body.startsAt ? new Date(body.startsAt) : new Date(), endsAt: body.endsAt ? new Date(body.endsAt) : null, createdById: req.auth!.user.id } });
      if (body.notifyUsers) {
        const users = await prisma.user.findMany({ where: { platformRole: 'NONE', status: 'ACTIVE' }, select: { id: true } });
        for (let i = 0; i < users.length; i += 500) {
          await prisma.notification.createMany({ data: users.slice(i, i + 500).map((u) => ({ userId: u.id, audience: 'USER', type: body.kind, title: body.title, body: body.body })) });
        }
      }
      await audit(req, { action: 'admin.announcement.create', entityType: 'Announcement', entityId: a.id, metadata: { kind: body.kind, notifyUsers: body.notifyUsers } });
      return a;
    });
    r.post('/announcements/:id/deactivate', { preHandler: requireAdminPerm('notifications.manage') }, async (req) => {
      const { id } = req.params as { id: string };
      await prisma.announcement.update({ where: { id }, data: { active: false } });
      await audit(req, { action: 'admin.announcement.deactivate', entityType: 'Announcement', entityId: id });
      return { ok: true };
    });

    // ------------------------------------------------------------ system settings (no payment gateway settings: deferred)
    r.get('/settings', { preHandler: requireAdminPerm('settings.read') }, async () => {
      const rows = await prisma.systemSetting.findMany();
      const migrations = await prisma.$queryRaw<{ migration_name: string; finished_at: Date }[]>`SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY finished_at DESC LIMIT 1`.catch(() => []);
      return {
        settings: Object.fromEntries(rows.map((r2) => [r2.key, r2.value])),
        environment: {
          appVersion: config.APP_VERSION,
          node: process.version,
          latestMigration: migrations[0]?.migration_name ?? null,
          smtpConfigured: !!config.SMTP_HOST,
          mailFrom: config.MAIL_FROM,
          fbrAllowedOrigins: config.FBR_ALLOWED_ORIGINS,
          fbrTimeouts: { connectMs: config.FBR_HTTP_CONNECT_TIMEOUT_MS, responseMs: config.FBR_HTTP_RESPONSE_TIMEOUT_MS },
          backupEncryptionConfigured: !!config.BACKUP_ENCRYPTION_KEY,
          backupDir: config.BACKUP_DIR,
        },
        deferred: ['Payment gateway settings (subscriptions are not part of this release)'],
      };
    });
    r.put('/settings/:key', { preHandler: requireAdminPerm('settings.manage') }, async (req) => {
      const { key } = z.object({ key: z.enum(SETTINGS_KEYS) }).parse(req.params);
      const value = settingSchemas[key].parse(req.body);
      await prisma.systemSetting.upsert({ where: { key }, create: { key, value, updatedById: req.auth!.user.id }, update: { value, updatedById: req.auth!.user.id } });
      await audit(req, { action: 'admin.settings.update', entityType: 'SystemSetting', entityId: key, metadata: { value } });
      return { ok: true };
    });

    // ------------------------------------------------------------ security
    r.get('/security/admins', { preHandler: requireAdminPerm('security.read') }, async () => {
      const rows = await prisma.user.findMany({ where: { platformRole: { not: 'NONE' } }, orderBy: { createdAt: 'asc' } });
      return rows.map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.platformRole, status: u.status, mfaEnrolled: !!u.totpEnabledAt, lastLoginAt: u.lastLoginAt, createdAt: u.createdAt }));
    });
    r.post('/security/admins/invite', { preHandler: requireAdminPerm('security.manage') }, async (req) => {
      const { email, role } = z.object({ email: z.string().trim().toLowerCase().email(), role: z.enum(['SUPER_ADMIN', 'ADMIN', 'SUPPORT', 'AUDITOR']) }).parse(req.body);
      let inv: Awaited<ReturnType<typeof createAdminInvite>>;
      try {
        inv = await createAdminInvite(email, role, { createdById: req.auth!.user.id });
      } catch (e) {
        throw badRequest((e as Error).message);
      }
      await audit(req, { action: 'admin.security.invite', entityType: 'User', entityId: inv.userId, metadata: { email, role } });
      const { sendMail, mailConfigured } = await import('../../lib/mailer.js');
      try {
        if (!mailConfigured()) throw new Error('SMTP is not configured');
        await sendMail(email, 'InvoiceGO administrator invitation', `You have been invited as an InvoiceGO ${role}.\nAccept within 24 hours:\n${inv.url}\nYou will be asked to enrol two-factor authentication at first sign-in.\n`, req.log);
        return { ok: true, emailed: true, message: `Invitation emailed to ${email}.` };
      } catch (e) {
        // The invitation exists; give the inviting SUPER_ADMIN the one-time link to deliver securely
        // (equivalent to the server CLI) instead of leaving an unusable invitation behind.
        req.log.warn({ err: (e as Error).message }, 'admin invite email not sent');
        return { ok: true, emailed: false, url: inv.url, expiresInHours: inv.expiresInHours, message: `The invitation was created but could not be emailed (${(e as Error).message}). Deliver the one-time link to ${email} over a secure channel.` };
      }
    });
    r.post('/security/admins/:id/role', { preHandler: requireAdminPerm('security.manage') }, async (req) => {
      const { id } = req.params as { id: string };
      const { role, status } = z.object({ role: z.enum(['SUPER_ADMIN', 'ADMIN', 'SUPPORT', 'AUDITOR']).optional(), status: z.enum(['ACTIVE', 'INACTIVE']).optional() }).parse(req.body);
      if (id === req.auth!.user.id) throw badRequest('You cannot change your own role or status');
      const target = await prisma.user.findFirst({ where: { id, platformRole: { not: 'NONE' } } });
      if (!target) throw notFound('Administrator');
      if (target.platformRole === 'SUPER_ADMIN' && (role !== 'SUPER_ADMIN' || status === 'INACTIVE')) {
        const supers = await prisma.user.count({ where: { platformRole: 'SUPER_ADMIN', status: 'ACTIVE' } });
        if (supers <= 1) throw conflict('At least one active SUPER_ADMIN must remain');
      }
      await prisma.user.update({ where: { id }, data: { ...(role ? { platformRole: role } : {}), ...(status ? { status } : {}) } });
      if (status === 'INACTIVE') await prisma.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      await audit(req, { action: 'admin.security.role', entityType: 'User', entityId: id, metadata: { role, status } });
      return { ok: true };
    });
    r.get('/security/login-history', { preHandler: requireAdminPerm('security.read') }, async (req) => {
      const q = z.object({ kind: z.enum(['ADMIN', 'USER']).default('ADMIN') }).parse(req.query);
      return prisma.loginEvent.findMany({ where: { kind: q.kind }, orderBy: { createdAt: 'desc' }, take: 200 });
    });
    r.get('/security/sessions', { preHandler: requireAdminPerm('security.read') }, async () => {
      const rows = await prisma.session.findMany({ where: { kind: 'ADMIN', revokedAt: null, expiresAt: { gt: new Date() } }, include: { user: { select: { email: true, name: true } } }, orderBy: { lastSeenAt: 'desc' } });
      return rows.map((s) => ({ id: s.id, user: s.user, ip: s.ip, userAgent: s.userAgent, createdAt: s.createdAt, lastSeenAt: s.lastSeenAt, mfaVerified: s.mfaVerified }));
    });
    r.delete('/security/sessions/:id', { preHandler: requireAdminPerm('security.manage') }, async (req) => {
      const { id } = req.params as { id: string };
      await prisma.session.updateMany({ where: { id }, data: { revokedAt: new Date() } });
      await audit(req, { action: 'admin.security.revoke_session', entityType: 'Session', entityId: id });
      return { ok: true };
    });
    r.get('/security/audit', { preHandler: requireAdminPerm('security.read') }, async (req) => {
      const q = z.object({ actorKind: z.enum(['ADMIN', 'USER', 'SYSTEM', '']).default('ADMIN'), action: z.string().default(''), page: z.coerce.number().int().min(1).default(1) }).parse(req.query);
      const where: Prisma.AuditLogWhereInput = { ...(q.actorKind ? { actorKind: q.actorKind } : {}), ...(q.action ? { action: { contains: q.action } } : {}) };
      const [total, rows] = await Promise.all([prisma.auditLog.count({ where }), prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, ...paging(q.page, 50) })]);
      return { total, rows };
    });

    // ------------------------------------------------------------ backups (restore is CLI-only)
    r.get('/backups', { preHandler: requireAdminPerm('settings.read') }, async () => {
      const rows = await prisma.backupRecord.findMany({ orderBy: { startedAt: 'desc' }, take: 50 });
      return { encryptionConfigured: !!config.BACKUP_ENCRYPTION_KEY, rows: rows.map((b) => ({ ...b, sizeBytes: b.sizeBytes?.toString() ?? null })) };
    });
    r.post('/backups/run', { preHandler: requireAdminPerm('backups.manage') }, async (req) => {
      if (!config.BACKUP_ENCRYPTION_KEY) throw conflict('Configure BACKUP_ENCRYPTION_KEY before running backups');
      const running = await prisma.job.count({ where: { type: 'backup.run', status: { in: ['QUEUED', 'RUNNING'] } } });
      if (running) throw conflict('A backup is already queued or running');
      const j = await enqueue('backup.run', {}, { createdById: req.auth!.user.id });
      await audit(req, { action: 'admin.backup.run', entityType: 'Job', entityId: j.id });
      return { queued: true };
    });
  });
}
