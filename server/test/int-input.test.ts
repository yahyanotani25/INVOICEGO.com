/** Integration: malformed input must produce 4xx, never 500 (no FBR calls). */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { call, createInvoice, fixClock, getApp, invoiceBody, newAdmin, newUser, prisma, realClock, resetDb, verifyAdminMfa, type Session } from './helpers';

let app: FastifyInstance;
let s: Session;
beforeAll(async () => {
  app = await getApp();
});
beforeEach(async () => {
  fixClock();
  await resetDb();
  s = await newUser(app);
});
afterAll(async () => {
  realClock();
  await app.close();
  await prisma.$disconnect();
});

describe('malformed input is rejected with 4xx', () => {
  it('user list filters with unknown enum values', async () => {
    for (const url of ['/api/app/invoices?status=FOO', '/api/app/invoices?status=ACCEPTED,BOGUS', '/api/app/invoices?environment=STAGING', '/api/app/invoices?from=2026-13-45']) {
      const r = await call(app, s, 'GET', url);
      expect(r.statusCode, `${url}: ${r.body}`).toBeGreaterThanOrEqual(400);
      expect(r.statusCode, url).toBeLessThan(500);
    }
    expect((await call(app, s, 'GET', '/api/app/invoices?status=ACCEPTED,DRAFT')).statusCode).toBe(200);
    expect((await call(app, s, 'GET', '/api/app/reports/summary?from=2026-02-30')).statusCode).toBe(400);
    expect((await call(app, s, 'GET', '/api/app/reports/summary?from=2026-01-01&to=2026-11-30')).statusCode).toBe(200);
  });

  it('admin list filters with unknown enum values', async () => {
    const a = await newAdmin(app);
    await verifyAdminMfa(app, a);
    for (const url of ['/api/admin/users?status=FOO', '/api/admin/invoices?status=FOO', '/api/admin/support?status=FOO', '/api/admin/fbr/attempts?outcome=FOO', '/api/admin/fbr/attempts?operation=FOO']) {
      const r = await call(app, a, 'GET', url);
      expect(r.statusCode, `${url}: ${r.body}`).toBeGreaterThanOrEqual(400);
      expect(r.statusCode, url).toBeLessThan(500);
    }
    expect((await call(app, a, 'GET', '/api/admin/users?status=ACTIVE')).statusCode).toBe(200);
  });

  it('invoice payload validation', async () => {
    expect((await call(app, s, 'POST', '/api/app/invoices', invoiceBody({ items: [] }))).statusCode).toBe(400);
    expect((await call(app, s, 'POST', '/api/app/invoices', invoiceBody({ environment: 'STAGING' }))).statusCode).toBe(400);
    expect((await call(app, s, 'POST', '/api/app/invoices', invoiceBody({}, { quantity: 'abc' }))).statusCode).toBe(400);
    const r = await call(app, s, 'POST', '/api/app/invoices', invoiceBody({ invoiceDate: '2026-11-31' }));
    expect(r.statusCode).toBe(422);
    expect(r.json().error.code).toBe('INVALID_DATE');
  });

  it('stale version updates are rejected (optimistic concurrency)', async () => {
    const inv = await createInvoice(app, s);
    expect((await call(app, s, 'PUT', `/api/app/invoices/${inv.id}`, { ...invoiceBody(), version: inv.version })).statusCode).toBe(200);
    const stale = await call(app, s, 'PUT', `/api/app/invoices/${inv.id}`, { ...invoiceBody(), version: inv.version });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe('STALE_VERSION');
  });

  it('unknown ids return 404', async () => {
    expect((await call(app, s, 'GET', '/api/app/invoices/does-not-exist')).statusCode).toBe(404);
    expect((await call(app, s, 'GET', '/api/app/hs-codes/0000.0000')).statusCode).toBe(404);
    expect((await call(app, s, 'GET', '/api/app/sandbox/scenarios/SN099/template')).statusCode).toBe(404);
  });
});
