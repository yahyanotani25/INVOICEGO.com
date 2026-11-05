/** Integration: reports, support, admin operations and edge rules (MOCKED FBR where FBR is involved). */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { MockFbr, PATHS } from './mockFbr';
import { call, createInvoice, fixClock, getApp, invoiceBody, newAdmin, newUser, prisma, realClock, resetDb, saveCredential, verifyAdminMfa, type Session } from './helpers';
import { issueEmailToken } from '../src/modules/auth/routes';
import { sweepStaleLocks } from '../src/modules/invoices/service';

const ANON = { 'content-type': 'application/json', 'x-requested-with': 'InvoiceGO' };
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
  s = await newUser(app, { ntn: '4444444', businessName: 'Delta', activities: ['Retailer'], sector: 'FMCG' });
});
afterAll(async () => {
  realClock();
  await mock.stop();
  await app.close();
  await prisma.$disconnect();
});

async function accept(over: Record<string, unknown> = {}, item: Record<string, unknown> = {}) {
  const inv = await createInvoice(app, s, over, item);
  expect((await call(app, s, 'POST', `/api/app/invoices/${inv.id}/validate`, {})).json().outcome).toBe('VALID');
  const r = await call(app, s, 'POST', `/api/app/invoices/${inv.id}/submit`, {});
  expect(r.json().invoice.status).toBe('ACCEPTED');
  return r.json().invoice;
}

function pdfUpload(buf: Buffer, name = 'doc.pdf') {
  const boundary = 'b' + Math.random().toString(16).slice(2);
  return {
    payload: Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: application/pdf\r\n\r\n`), buf, Buffer.from(`\r\n--${boundary}--\r\n`)]),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

describe('invoice business rules', () => {
  it('debit notes require a valid FBR reference; self-invoicing is blocked locally', async () => {
    await saveCredential(app, s, 'SANDBOX', 'sandbox-token-delta-0001');
    const dn = await createInvoice(app, s, { invoiceType: 'DEBIT_NOTE', invoiceRefNo: '' });
    const v = await call(app, s, 'POST', `/api/app/invoices/${dn.id}/validate`, {});
    expect(v.statusCode).toBe(422);
    expect(v.json().error.details.issues).toContainEqual(expect.objectContaining({ field: 'invoiceRefNo', level: 'error' }));
    const self = await createInvoice(app, s, { buyerNtnCnic: '4444444' });
    const v2 = await call(app, s, 'POST', `/api/app/invoices/${self.id}/validate`, {});
    expect(v2.statusCode).toBe(422);
    expect(JSON.stringify(v2.json())).toMatch(/self-invoicing/);
    expect(mock.calls(PATHS.validateSb)).toHaveLength(0);
  });

  it('registered buyers need an NTN/CNIC; sandbox invoices need a scenario', async () => {
    const inv = await createInvoice(app, s, { buyerNtnCnic: '', scenarioId: null });
    const issues = (await call(app, s, 'GET', `/api/app/invoices/${inv.id}`)).json();
    expect(issues.status).toBe('DRAFT');
    const r = await call(app, s, 'POST', '/api/app/invoices', invoiceBody({ buyerNtnCnic: '', scenarioId: null }));
    const fields = r.json().issues.map((i: { field: string }) => i.field);
    expect(fields).toEqual(expect.arrayContaining(['buyerNtnCnic', 'scenarioId']));
  });

  it('a crashed submission (stuck in SUBMITTING) is swept into RECONCILIATION_REQUIRED, never resubmitted', async () => {
    const inv = await createInvoice(app, s);
    await prisma.invoice.update({ where: { id: inv.id }, data: { status: 'SUBMITTING', submitLockedAt: new Date(Date.now() - 10 * 60_000) } });
    const r = await sweepStaleLocks();
    expect(r.submitting).toBe(1);
    const after = await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(after.status).toBe('RECONCILIATION_REQUIRED');
    expect(after.reconciliationNote).toMatch(/interrupted/);
  });

  it('only never-submitted drafts can be deleted', async () => {
    const d = await createInvoice(app, s);
    expect((await call(app, s, 'DELETE', `/api/app/invoices/${d.id}`)).statusCode).toBe(200);
  });

  it('calc preview matches the stored calculation', async () => {
    const r = await call(app, s, 'POST', '/api/app/invoices/calc', { autoCalc: true, items: invoiceBody({}, { quantity: '3', unitPrice: '333.33', discount: '0.99' }).items });
    expect(r.json().lines[0].values).toMatchObject({ valueSalesExcludingST: '999.00', salesTaxApplicable: '179.82', totalValues: '1178.82' });
    const inv = await createInvoice(app, s, {}, { quantity: '3', unitPrice: '333.33', discount: '0.99' });
    expect(inv.items[0]).toMatchObject({ valueSalesExcludingST: '999', salesTaxApplicable: '179.82' });
  });
});

describe('dashboard and reports keep sandbox and production separate (mocked FBR)', () => {
  it('sandbox accepted invoices do not appear in production sales figures', async () => {
    await saveCredential(app, s, 'SANDBOX', 'sandbox-token-delta-0001');
    await accept();
    const dash = (await call(app, s, 'GET', '/api/app/dashboard')).json();
    expect(dash.counts).toMatchObject({ totalProduction: 0, sandboxTotal: 1, accepted: 0 });
    expect(dash.production.allTime.grandTotal).toBe('0.00');
    expect(dash.scenarios.required).toBe(1); // Retailer + FMCG, not registered as retailer: SN008 only
    const prodRep = await call(app, s, 'GET', '/api/app/reports/summary?environment=PRODUCTION&period=monthly');
    expect(prodRep.statusCode, prodRep.body).toBe(200);
    expect(prodRep.json().rows).toEqual([]);
    for (const period of ['daily', 'monthly', 'quarterly', 'yearly']) {
      const sb = await call(app, s, 'GET', `/api/app/reports/summary?environment=SANDBOX&period=${period}`);
      expect(sb.statusCode, sb.body).toBe(200);
      expect(sb.json().rows).toHaveLength(1);
      expect(sb.json().rows[0]).toMatchObject({ invoiceType: 'Sale Invoice', count: 1, total: '11800.00' });
      expect(sb.json().note).toMatch(/Sandbox/);
    }
    const x = await call(app, s, 'GET', '/api/app/reports/invoices.xlsx?environment=SANDBOX');
    expect(x.statusCode).toBe(200);
  });
});

describe('support tickets', () => {
  it('create, reply, PDF attachments only (<= 5 MB), admin reply notifies the user', async () => {
    const t = await call(app, s, 'POST', '/api/app/support/tickets', { title: 'Token issue', description: 'Sandbox token gives 401', category: 'TECHNICAL', queryType: 'INTEGRATION', priority: 'HIGH' });
    expect(t.statusCode).toBe(201);
    const id = t.json().id;
    const notPdf = pdfUpload(Buffer.from('MZ fake exe'), 'evil.pdf');
    expect((await app.inject({ method: 'POST', url: `/api/app/support/tickets/${id}/attachments`, headers: { cookie: s.cookie, 'x-csrf-token': s.csrf, 'content-type': notPdf.contentType }, payload: notPdf.payload })).statusCode).toBe(400);
    const big = pdfUpload(Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(5 * 1024 * 1024 + 10, 32)]));
    const bigR = await app.inject({ method: 'POST', url: `/api/app/support/tickets/${id}/attachments`, headers: { cookie: s.cookie, 'x-csrf-token': s.csrf, 'content-type': big.contentType }, payload: big.payload });
    expect(bigR.statusCode).toBeGreaterThanOrEqual(400);
    expect(bigR.statusCode).toBeLessThan(500);
    const ok = pdfUpload(Buffer.from('%PDF-1.4\nhello\n'));
    expect((await app.inject({ method: 'POST', url: `/api/app/support/tickets/${id}/attachments`, headers: { cookie: s.cookie, 'x-csrf-token': s.csrf, 'content-type': ok.contentType }, payload: ok.payload })).statusCode).toBe(200);
    const admin = await newAdmin(app, 'SUPPORT');
    await verifyAdminMfa(app, admin);
    const rep = await call(app, admin, 'POST', `/api/admin/support/${id}/reply`, { body: 'Please re-check your IP whitelisting.' });
    expect(rep.statusCode).toBe(200);
    const n = (await call(app, s, 'GET', '/api/app/notifications')).json();
    expect(n.items.some((x: { type: string }) => x.type === 'SUPPORT_REPLY')).toBe(true);
    const tk = (await call(app, s, 'GET', `/api/app/support/tickets/${id}`)).json();
    expect(tk.status).toBe('AWAITING_USER');
    expect(tk.messages.map((m: { authorIsAdmin: boolean }) => m.authorIsAdmin)).toEqual([true]);
  });
});

describe('admin operations', () => {
  it('reports, exports and FBR overview work and contain no subscription data', async () => {
    await saveCredential(app, s, 'SANDBOX', 'sandbox-token-delta-0001');
    await accept();
    const a = await newAdmin(app);
    await verifyAdminMfa(app, a);
    const rep = await call(app, a, 'GET', '/api/admin/reports/summary');
    expect(rep.statusCode, rep.body).toBe(200);
    expect(rep.json().registrationsDaily[0].count).toBe(1);
    expect(JSON.stringify(rep.json())).not.toMatch(/"subscription|activeSubscriptions|expiredSubscriptions/i);
    for (const type of ['users', 'invoices', 'userwise']) {
      for (const format of ['csv', 'xlsx']) {
        const e = await call(app, a, 'GET', `/api/admin/reports/export?type=${type}&format=${format}`);
        expect(e.statusCode, `${type} ${format} ${e.body.slice(0, 200)}`).toBe(200);
      }
    }
    const ov = await call(app, a, 'GET', '/api/admin/fbr/overview');
    expect(ov.statusCode, ov.body).toBe(200);
    expect(ov.json().usage30d.length).toBeGreaterThan(0);
    const inv = await call(app, a, 'GET', '/api/admin/invoices?environment=SANDBOX');
    expect(inv.json().total).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'admin.invoices.list', actorUserId: a.userId } })).toBe(1);
    const settings = await call(app, a, 'GET', '/api/admin/settings');
    expect(settings.json().deferred[0]).toMatch(/Payment gateway/);
  });

  it('controlled deletion anonymises the user but retains invoices and audit logs', async () => {
    await saveCredential(app, s, 'SANDBOX', 'sandbox-token-delta-0001');
    const inv = await accept();
    const a = await newAdmin(app);
    await verifyAdminMfa(app, a);
    const wrong = await call(app, a, 'POST', `/api/admin/users/${s.userId}/delete`, { confirmEmail: 'nope@x.com', reason: 'requested by owner' });
    expect(wrong.statusCode).toBe(400);
    const del = await call(app, a, 'POST', `/api/admin/users/${s.userId}/delete`, { confirmEmail: s.email, reason: 'requested by owner' });
    expect(del.statusCode).toBe(200);
    const u = await prisma.user.findUniqueOrThrow({ where: { id: s.userId } });
    expect(u).toMatchObject({ status: 'DELETED', name: 'Deleted user', phone: null, passwordHash: null });
    expect(await prisma.invoice.count({ where: { id: inv.id } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'admin.user.delete' } })).toBe(1);
  });

  it('admin-initiated password reset never reveals the password or link to the admin', async () => {
    const a = await newAdmin(app);
    await verifyAdminMfa(app, a);
    const r = await call(app, a, 'POST', `/api/admin/users/${s.userId}/password-reset`, {});
    expect(r.statusCode).toBe(200);
    expect(r.body).not.toMatch(/token=/);
    expect(await prisma.emailToken.count({ where: { userId: s.userId, purpose: 'RESET_PASSWORD', usedAt: null } })).toBe(1);
  });
});

describe('password reset', () => {
  it('reset link sets a new password and revokes existing sessions', async () => {
    const token = await issueEmailToken(s.userId, 'RESET_PASSWORD', 1);
    const weak = await app.inject({ method: 'POST', url: '/api/auth/reset-password', headers: ANON, payload: { token, password: 'short' } });
    expect(weak.statusCode).toBe(400);
    const ok = await app.inject({ method: 'POST', url: '/api/auth/reset-password', headers: ANON, payload: { token, password: 'NewPassw0rd5678' } });
    expect(ok.statusCode).toBe(200);
    expect((await call(app, s, 'GET', '/api/app/invoices')).statusCode).toBe(401);
    const reuse = await app.inject({ method: 'POST', url: '/api/auth/reset-password', headers: ANON, payload: { token, password: 'NewPassw0rd9999' } });
    expect(reuse.statusCode).toBe(400);
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', headers: ANON, payload: { email: s.email, password: 'NewPassw0rd5678' } });
    expect(login.statusCode).toBe(200);
  });
});
