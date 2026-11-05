/** Integration regressions for post-review fixes (MOCKED FBR where FBR is involved). */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { MockFbr, PATHS } from './mockFbr';
import { call, createInvoice, fixClock, getApp, newAdmin, newUser, prisma, realClock, resetDb, verifyAdminMfa, type Session } from './helpers';

const mock = new MockFbr();
let app: FastifyInstance;
let s: Session;

beforeAll(async () => {
  await mock.start();
  app = await getApp();
});
beforeEach(async () => {
  fixClock();
  await resetDb();
  mock.reset();
  s = await newUser(app, { ntn: '5555555', businessName: 'Echo Traders' });
});
afterAll(async () => {
  realClock();
  await mock.stop();
  await app.close();
  await prisma.$disconnect();
});

describe('configuration errors do not change invoice state', () => {
  it('validate/submit without a token fail fast and leave the draft untouched (nothing is sent)', async () => {
    const inv = await createInvoice(app, s);
    const v = await call(app, s, 'POST', `/api/app/invoices/${inv.id}/validate`, {});
    expect(v.statusCode).toBe(409);
    expect(v.json().error.code).toBe('FBR_NOT_CONFIGURED');
    const after = await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(after.status).toBe('DRAFT');
    expect(await prisma.fbrAttempt.count({ where: { invoiceId: inv.id } })).toBe(0);
    expect(mock.calls(PATHS.validateSb)).toHaveLength(0);
  });
});

describe('admin invitation when email cannot be sent', () => {
  it('returns the one-time link to the inviting SUPER_ADMIN instead of failing with an orphan invite', async () => {
    const a = await newAdmin(app, 'SUPER_ADMIN');
    await verifyAdminMfa(app, a);
    const r = await call(app, a, 'POST', '/api/admin/security/admins/invite', { email: 'second-admin@invoicego.test', role: 'SUPPORT' });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    // SMTP is not configured in tests
    expect(body.emailed).toBe(false);
    expect(body.url).toMatch(/\/admin\/accept-invite\?token=/);
    const u = await prisma.user.findUniqueOrThrow({ where: { email: 'second-admin@invoicego.test' } });
    expect(u.platformRole).toBe('SUPPORT');
    expect(u.passwordHash).toBeNull();
  });
});

describe('admin registration reports use Pakistan time', () => {
  it('a sign-up at 20:30 UTC is counted on the next PKT day', async () => {
    const a = await newAdmin(app, 'SUPER_ADMIN');
    await verifyAdminMfa(app, a);
    const u = await prisma.user.findFirstOrThrow({ where: { platformRole: 'NONE' } });
    await prisma.user.update({ where: { id: u.id }, data: { createdAt: new Date(Date.now() - 3 * 24 * 3600_000) } });
    const t = new Date(Date.now() - 3 * 24 * 3600_000);
    t.setUTCHours(20, 30, 0, 0); // 01:30 PKT on the following day
    await prisma.user.update({ where: { id: u.id }, data: { createdAt: t } });
    const r = await call(app, a, 'GET', '/api/admin/reports/summary');
    expect(r.statusCode).toBe(200);
    const nextDay = new Date(t.getTime() + 5 * 3600_000).toISOString().slice(0, 10);
    expect(r.json().registrationsDaily).toContainEqual({ day: nextDay, count: 1 });
  });
});
