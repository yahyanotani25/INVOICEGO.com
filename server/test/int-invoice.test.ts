/**
 * Integration: invoice lifecycle against a MOCKED FBR gateway (test/mockFbr.ts).
 * These tests prove InvoiceGO's own behaviour; they are NOT evidence of real FBR acceptance.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { MockFbr, PATHS, headerInvalid, itemInvalid, fbrNumber } from './mockFbr';
import { call, createInvoice, fixClock, getApp, invoiceBody, newAdmin, newUser, prisma, realClock, resetDb, saveCredential, verifyAdminMfa, type Session } from './helpers';
import { __setClock } from '../src/lib/time';

const MSG = "You can't create future or previous month invoices";
const SB_TOKEN = 'sandbox-token-SECRET-abc123-zz99';
const PROD_TOKEN = 'production-token-SECRET-xyz789-qq11';
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
  s = await newUser(app, { ntn: '1234567', businessName: 'Khan Traders' });
});
afterAll(async () => {
  realClock();
  await mock.stop();
  await app.close();
  await prisma.$disconnect();
});

async function validated(over: Record<string, unknown> = {}, item: Record<string, unknown> = {}) {
  await saveCredential(app, s, 'SANDBOX', SB_TOKEN);
  const inv = await createInvoice(app, s, over, item);
  const v = await call(app, s, 'POST', `/api/app/invoices/${inv.id}/validate`, {});
  expect(v.statusCode, v.body).toBe(200);
  expect(v.json().outcome).toBe('VALID');
  return inv;
}

describe('current-month rule cannot be bypassed through the API', () => {
  it('create and update reject previous and next month with the exact message', async () => {
    for (const d of ['2026-10-31', '2026-12-01']) {
      const r = await call(app, s, 'POST', '/api/app/invoices', invoiceBody({ invoiceDate: d }));
      expect(r.statusCode).toBe(422);
      expect(r.json().error).toMatchObject({ code: 'MONTH_RULE', message: MSG });
    }
    const inv = await createInvoice(app, s);
    const u = await call(app, s, 'PUT', `/api/app/invoices/${inv.id}`, invoiceBody({ invoiceDate: '2026-10-01' }));
    expect(u.statusCode).toBe(422);
    expect(u.json().error.message).toBe(MSG);
  });

  it('a draft from last month cannot be validated or submitted after the month changes; duplicate uses today', async () => {
    await saveCredential(app, s, 'SANDBOX', SB_TOKEN);
    const inv = await createInvoice(app, s); // 15 Nov
    const v1 = await call(app, s, 'POST', `/api/app/invoices/${inv.id}/validate`, {});
    expect(v1.json().outcome).toBe('VALID');
    __setClock(() => new Date('2026-12-02T07:00:00Z'));
    const v = await call(app, s, 'POST', `/api/app/invoices/${inv.id}/validate`, {});
    expect(v.statusCode).toBe(422);
    expect(v.json().error).toMatchObject({ code: 'MONTH_RULE', message: MSG });
    const sub = await call(app, s, 'POST', `/api/app/invoices/${inv.id}/submit`, {});
    expect(sub.statusCode).toBe(422);
    expect(sub.json().error.message).toBe(MSG);
    expect(mock.calls(PATHS.postSb)).toHaveLength(0);
    const dup = await call(app, s, 'POST', `/api/app/invoices/${inv.id}/duplicate`, {});
    expect(dup.statusCode).toBe(201);
    expect(dup.json().invoice.invoiceDate).toBe('2026-12-02');
    // the historical invoice is still viewable
    expect((await call(app, s, 'GET', `/api/app/invoices/${inv.id}`)).json().invoiceDate).toBe('2026-11-15');
  });
});

describe('buyer registration verification (mocked Get_Reg_Type)', () => {
  it('Registered buyer selected as Unregistered -> exact message with buyer name, submission blocked', async () => {
    await saveCredential(app, s, 'SANDBOX', SB_TOKEN);
    mock.regTypes['7654321'] = 'Registered';
    const inv = await createInvoice(app, s, { buyerRegistrationType: 'UNREGISTERED', buyerBusinessName: 'ABC Traders' });
    const r = await call(app, s, 'POST', `/api/app/invoices/${inv.id}/validate`, {});
    expect(r.statusCode).toBe(422);
    expect(r.json().error).toMatchObject({ code: 'BUYER_REGISTRATION_MISMATCH', message: 'ABC Traders is Registered. Please select Registered.' });
    expect(r.json().error.details.issues[0].field).toBe('buyerRegistrationType');
    expect(mock.calls(PATHS.validateSb)).toHaveLength(0);
    const saved = await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(saved.buyerCheckResult).toBe('REGISTERED');
    expect(saved.buyerCheckAt).not.toBeNull();
  });

  it('Unregistered buyer selected as Registered -> exact message with buyer name', async () => {
    await saveCredential(app, s, 'SANDBOX', SB_TOKEN);
    mock.regTypes['7654321'] = 'unregistered';
    const inv = await createInvoice(app, s, { buyerRegistrationType: 'REGISTERED', buyerBusinessName: 'Walk In Store' });
    const r = await call(app, s, 'POST', `/api/app/invoices/${inv.id}/validate`, {});
    expect(r.statusCode).toBe(422);
    expect(r.json().error.message).toBe('Walk In Store is Unregistered. Please select Unregistered.');
  });

  it('a lookup timeout is UNAVAILABLE, never "unregistered": validation proceeds', async () => {
    await saveCredential(app, s, 'SANDBOX', SB_TOKEN);
    mock.regTypes['7654321'] = 'hang';
    const inv = await createInvoice(app, s, { buyerRegistrationType: 'REGISTERED' });
    const r = await call(app, s, 'POST', `/api/app/invoices/${inv.id}/validate`, {});
    expect(r.statusCode).toBe(200);
    expect(r.json().buyerCheck.result).toBe('UNAVAILABLE');
    expect(r.json().buyerCheck.mismatch).toBe(false);
    expect(r.json().outcome).toBe('VALID');
    const bv = await prisma.buyerVerification.findFirst({ where: { registrationNo: '7654321' }, orderBy: { checkedAt: 'desc' } });
    expect(bv!.result).toBe('UNAVAILABLE');
  });

  it('customer verification endpoint reports mismatch by name', async () => {
    await saveCredential(app, s, 'SANDBOX', SB_TOKEN);
    mock.regTypes['7000001'] = 'Registered';
    const c = await call(app, s, 'POST', '/api/app/customers', { name: 'Gamma Ltd', ntnCnic: '7000001', province: 'Punjab', address: 'Lahore', registrationType: 'UNREGISTERED' });
    const v = await call(app, s, 'POST', `/api/app/customers/${c.json().id}/verify`, {});
    expect(v.json()).toMatchObject({ result: 'REGISTERED', mismatch: true, message: 'Gamma Ltd is Registered. Please select Registered.' });
  });
});

describe('sandbox happy path (mocked FBR)', () => {
  it('validate -> submit -> ACCEPTED with FBR numbers, exact payload stored, scenario passed', async () => {
    const inv = await validated({}, { quantity: '10', unitPrice: '1000', discount: '500' });
    const r = await call(app, s, 'POST', `/api/app/invoices/${inv.id}/submit`, {});
    expect(r.statusCode, r.body).toBe(200);
    const body = r.json();
    expect(body.outcome).toBe('VALID');
    expect(body.invoice.status).toBe('ACCEPTED');
    expect(body.invoice.fbrInvoiceNumber).toMatch(/^7000007DI\d{13}$/);
    expect(body.invoice.items[0].fbr.itemInvoiceNo).toBe(`${body.invoice.fbrInvoiceNumber}-1`);
    const posts = mock.calls(PATHS.postSb);
    expect(posts).toHaveLength(1);
    expect(posts[0].headers.authorization).toBe(`Bearer ${SB_TOKEN}`);
    expect(posts[0].json.scenarioId).toBe('SN001');
    expect(posts[0].json.items[0]).toMatchObject({ valueSalesExcludingST: 9500, salesTaxApplicable: 1710, totalValues: 11210, discount: 500 });
    const snap = await prisma.invoiceSnapshot.findFirstOrThrow({ where: { invoiceId: inv.id, kind: 'SUBMITTED' } });
    expect(snap.payloadText).toBe(posts[0].body);
    expect(await prisma.invoiceSnapshot.count({ where: { invoiceId: inv.id, kind: 'ACCEPTED' } })).toBe(1);
    const prog = await prisma.scenarioProgress.findUniqueOrThrow({ where: { businessId_scenarioId: { businessId: s.businessId, scenarioId: 'SN001' } } });
    expect(prog).toMatchObject({ status: 'PASSED', passedFbrNumber: body.invoice.fbrInvoiceNumber });
    expect(mock.calls(PATHS.post)).toHaveLength(0); // never production
  });

  it('accepted invoices are immutable and cannot be resubmitted or deleted', async () => {
    const inv = await validated();
    await call(app, s, 'POST', `/api/app/invoices/${inv.id}/submit`, {});
    const put = await call(app, s, 'PUT', `/api/app/invoices/${inv.id}`, invoiceBody());
    expect(put.statusCode).toBe(409);
    const again = await call(app, s, 'POST', `/api/app/invoices/${inv.id}/submit`, {});
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('ALREADY_ACCEPTED');
    const del = await call(app, s, 'DELETE', `/api/app/invoices/${inv.id}`);
    expect(del.statusCode).toBe(409);
    const val = await call(app, s, 'POST', `/api/app/invoices/${inv.id}/validate`, {});
    expect(val.statusCode).toBe(409);
    expect(mock.calls(PATHS.postSb)).toHaveLength(1);
  });

  it('a scenario is not passed by a valid local form or HTTP 200 alone (item-level invalid -> REJECTED)', async () => {
    const inv = await validated();
    mock.on(PATHS.postSb, itemInvalid);
    const r = await call(app, s, 'POST', `/api/app/invoices/${inv.id}/submit`, {});
    expect(r.json().outcome).toBe('INVALID');
    expect(r.json().invoice.status).toBe('REJECTED');
    expect(r.json().invoice.items[0].fbr).toMatchObject({ statusCode: '01', errorCode: '0046', error: 'Provide rate.' });
    expect(r.json().issues[0]).toMatchObject({ code: '0046', known: true, field: 'rate' });
    const prog = await prisma.scenarioProgress.findUniqueOrThrow({ where: { businessId_scenarioId: { businessId: s.businessId, scenarioId: 'SN001' } } });
    expect(prog.status).toBe('FAILED');
  });

  it('header-level invalid validation returns explained FBR error 0052', async () => {
    await saveCredential(app, s, 'SANDBOX', SB_TOKEN);
    const inv = await createInvoice(app, s);
    mock.on(PATHS.validateSb, headerInvalid);
    const r = await call(app, s, 'POST', `/api/app/invoices/${inv.id}/validate`, {});
    expect(r.json().outcome).toBe('INVALID');
    expect(r.json().invoice.status).toBe('VALIDATION_FAILED');
    expect(r.json().issues[0]).toMatchObject({ code: '0052', known: true, field: 'hsCode', fbrMessage: expect.stringMatching(/HS Code/) });
  });

  it('changing an item after validation invalidates it; submit then requires re-validation', async () => {
    const inv = await validated();
    const u = await call(app, s, 'PUT', `/api/app/invoices/${inv.id}`, invoiceBody({}, { quantity: '11' }));
    expect(u.statusCode).toBe(200);
    expect(u.json().invoice.status).toBe('DRAFT');
    const sub = await call(app, s, 'POST', `/api/app/invoices/${inv.id}/submit`, {});
    expect(sub.statusCode).toBe(409);
    expect(sub.json().error.code).toBe('VALIDATION_REQUIRED');
    expect(mock.calls(PATHS.postSb)).toHaveLength(0);
  });

  it('a draft cannot be submitted without validation', async () => {
    await saveCredential(app, s, 'SANDBOX', SB_TOKEN);
    const inv = await createInvoice(app, s);
    expect((await call(app, s, 'POST', `/api/app/invoices/${inv.id}/submit`, {})).json().error.code).toBe('VALIDATION_REQUIRED');
  });
});

describe('duplicate submission prevention (mocked FBR)', () => {
  it('two concurrent submits -> exactly one POST reaches FBR, the other gets 409', async () => {
    const inv = await validated();
    mock.on(PATHS.postSb, (req) => {
      const n = fbrNumber();
      return {
        delayMs: 300,
        body: { invoiceNumber: n, dated: 'x', validationResponse: { statusCode: '00', status: 'Valid', error: '', invoiceStatuses: (req.json.items as unknown[]).map((_, i) => ({ itemSNo: String(i + 1), statusCode: '00', status: 'Valid', invoiceNo: `${n}-${i + 1}` })) } },
      };
    });
    const [a, b] = await Promise.all([call(app, s, 'POST', `/api/app/invoices/${inv.id}/submit`, {}), call(app, s, 'POST', `/api/app/invoices/${inv.id}/submit`, {})]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
    expect(mock.calls(PATHS.postSb)).toHaveLength(1);
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } })).status).toBe('ACCEPTED');
  });
});

describe('uncertain outcomes require reconciliation (mocked FBR)', () => {
  it('HTTP 500 on post -> RECONCILIATION_REQUIRED; no blind resubmit', async () => {
    const inv = await validated();
    mock.on(PATHS.postSb, () => ({ status: 500, body: 'Internal Server Error' }));
    const r = await call(app, s, 'POST', `/api/app/invoices/${inv.id}/submit`, {});
    expect(r.json().invoice.status).toBe('RECONCILIATION_REQUIRED');
    const again = await call(app, s, 'POST', `/api/app/invoices/${inv.id}/submit`, {});
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('RECONCILIATION_REQUIRED');
    expect(mock.calls(PATHS.postSb)).toHaveLength(1);
  });

  it('response timeout -> RECONCILIATION_REQUIRED; reconcile NOT_RECORDED -> DRAFT needing re-validation', async () => {
    const inv = await validated();
    mock.on(PATHS.postSb, () => ({ hang: true }));
    const r = await call(app, s, 'POST', `/api/app/invoices/${inv.id}/submit`, {});
    expect(r.json().outcome).toBe('UNCERTAIN');
    expect(r.json().invoice.status).toBe('RECONCILIATION_REQUIRED');
    const attempt = await prisma.fbrAttempt.findFirstOrThrow({ where: { invoiceId: inv.id, operation: 'POST' } });
    expect(attempt.outcome).toBe('UNCERTAIN');
    const rec = await call(app, s, 'POST', `/api/app/invoices/${inv.id}/reconcile`, { resolution: 'NOT_RECORDED', note: 'Checked IRIS dashboard: not present' });
    expect(rec.statusCode).toBe(200);
    expect(rec.json().status).toBe('DRAFT');
    const sub = await call(app, s, 'POST', `/api/app/invoices/${inv.id}/submit`, {});
    expect(sub.json().error.code).toBe('VALIDATION_REQUIRED');
    expect(mock.calls(PATHS.postSb)).toHaveLength(1);
  });

  it('reconcile ACCEPTED records the FBR number from IRIS and marks it', async () => {
    const inv = await validated();
    mock.on(PATHS.postSb, () => ({ status: 502, body: 'bad gateway' }));
    await call(app, s, 'POST', `/api/app/invoices/${inv.id}/submit`, {});
    const bad = await call(app, s, 'POST', `/api/app/invoices/${inv.id}/reconcile`, { resolution: 'ACCEPTED', fbrInvoiceNumber: 'not-a-number-xx', note: 'found in IRIS' });
    expect(bad.statusCode).toBe(422);
    const rec = await call(app, s, 'POST', `/api/app/invoices/${inv.id}/reconcile`, { resolution: 'ACCEPTED', fbrInvoiceNumber: '1234567DI1747119709999', note: 'Found in IRIS dashboard' });
    expect(rec.statusCode).toBe(200);
    expect(rec.json()).toMatchObject({ status: 'ACCEPTED', fbrInvoiceNumber: '1234567DI1747119709999', acceptedViaReconcile: true });
  });

  it('401 on post is not acceptance: status returns to VALIDATED (definitely not recorded)', async () => {
    const inv = await validated();
    mock.on(PATHS.postSb, () => ({ status: 401, body: '' }));
    const r = await call(app, s, 'POST', `/api/app/invoices/${inv.id}/submit`, {});
    expect(r.json().outcome).toBe('AUTH_ERROR');
    expect(r.json().invoice.status).toBe('VALIDATED');
    expect(r.json().invoice.fbrInvoiceNumber).toBeNull();
  });
});

describe('production separation (mocked FBR)', () => {
  it('production requires a tested production token; production payload has no scenarioId and uses non-_sb paths', async () => {
    // A production draft can be saved before production is enabled, but it cannot reach FBR.
    const draft = await call(app, s, 'POST', '/api/app/invoices', invoiceBody({ environment: 'PRODUCTION', scenarioId: null }));
    expect(draft.statusCode, draft.body).toBe(201);
    const blocked = await call(app, s, 'POST', `/api/app/invoices/${draft.json().invoice.id}/validate`, {});
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error.code).toBe('PRODUCTION_DISABLED');
    expect(mock.calls(PATHS.validate)).toHaveLength(0);
    await saveCredential(app, s, 'PRODUCTION', PROD_TOKEN);
    const en1 = await call(app, s, 'POST', '/api/app/fbr/production/enable', { confirm: true });
    expect(en1.statusCode).toBe(409); // not tested yet
    const t = await call(app, s, 'POST', '/api/app/fbr/credentials/production/test', {});
    expect(t.json().result.status).toBe('OK');
    expect(mock.calls(PATHS.provinces)[0].headers.authorization).toBe(`Bearer ${PROD_TOKEN}`);
    expect((await call(app, s, 'POST', '/api/app/fbr/production/enable', { confirm: true })).statusCode).toBe(200);

    const inv = await createInvoice(app, s, { environment: 'PRODUCTION', scenarioId: 'SN001' });
    expect(inv.scenarioId).toBeNull();
    const v = await call(app, s, 'POST', `/api/app/invoices/${inv.id}/validate`, {});
    expect(v.json().outcome).toBe('VALID');
    const sub = await call(app, s, 'POST', `/api/app/invoices/${inv.id}/submit`, {});
    expect(sub.json().invoice.status).toBe('ACCEPTED');
    const posts = mock.calls(PATHS.post);
    expect(posts).toHaveLength(1);
    expect(posts[0].json).not.toHaveProperty('scenarioId');
    expect(posts[0].headers.authorization).toBe(`Bearer ${PROD_TOKEN}`);
    expect(mock.calls(PATHS.postSb)).toHaveLength(0);
    expect(mock.calls(PATHS.validate)).toHaveLength(1);
  });

  it('a sandbox invoice is always sent to the sandbox URL even when production is enabled', async () => {
    await saveCredential(app, s, 'PRODUCTION', PROD_TOKEN);
    await call(app, s, 'POST', '/api/app/fbr/credentials/production/test', {});
    await call(app, s, 'POST', '/api/app/fbr/production/enable', { confirm: true });
    const inv = await validated();
    await call(app, s, 'POST', `/api/app/invoices/${inv.id}/submit`, {});
    expect(mock.calls(PATHS.postSb)).toHaveLength(1);
    expect(mock.calls(PATHS.post)).toHaveLength(0);
    expect(mock.calls(PATHS.validate)).toHaveLength(0);
  });

  it('replacing the production token disables production until re-tested', async () => {
    await saveCredential(app, s, 'PRODUCTION', PROD_TOKEN);
    await call(app, s, 'POST', '/api/app/fbr/credentials/production/test', {});
    await call(app, s, 'POST', '/api/app/fbr/production/enable', { confirm: true });
    await saveCredential(app, s, 'PRODUCTION', 'another-production-token-0001');
    const b = await prisma.business.findUniqueOrThrow({ where: { id: s.businessId } });
    expect(b.productionEnabled).toBe(false);
  });
});

describe('token secrecy', () => {
  it('tokens are encrypted at rest and never returned or logged in attempts', async () => {
    const inv = await validated();
    await call(app, s, 'POST', `/api/app/invoices/${inv.id}/submit`, {});
    const cred = await prisma.fbrCredential.findFirstOrThrow({ where: { businessId: s.businessId, environment: 'SANDBOX' } });
    expect(cred.tokenEnc).not.toContain(SB_TOKEN);
    expect(cred.tokenEnc).toMatch(/^v1:/);
    const view = await call(app, s, 'GET', '/api/app/fbr/credentials');
    expect(view.body).not.toContain(SB_TOKEN);
    expect(view.json().credentials[0].tokenMasked).toBe('••••••••zz99');
    const attempts = await prisma.fbrAttempt.findMany({ where: { businessId: s.businessId } });
    expect(attempts.length).toBeGreaterThan(0);
    expect(JSON.stringify(attempts)).not.toContain(SB_TOKEN);
    const atts = await call(app, s, 'GET', `/api/app/invoices/${inv.id}/attempts`);
    expect(atts.body).not.toContain(SB_TOKEN);
    const admin = await newAdmin(app);
    await verifyAdminMfa(app, admin);
    const detail = await call(app, admin, 'GET', `/api/admin/users/${s.userId}`);
    expect(detail.statusCode).toBe(200);
    expect(detail.body).not.toContain(SB_TOKEN);
    expect(detail.json().businesses[0].credentials[0].tokenMasked).toBe('••••••••zz99');
    const overview = await call(app, admin, 'GET', '/api/admin/fbr/overview');
    expect(overview.body).not.toContain(SB_TOKEN);
  });

  it('rejects credential URLs outside the allow-list (SSRF guard)', async () => {
    const r = await call(app, s, 'PUT', '/api/app/fbr/credentials/sandbox', { postUrl: 'http://169.254.169.254/di_data/v1/di/postinvoicedata_sb', token: SB_TOKEN });
    expect(r.statusCode).toBe(400);
    const r2 = await call(app, s, 'PUT', '/api/app/fbr/credentials/sandbox', { postUrl: 'https://gw.fbr.gov.pk/di_data/v1/di/postinvoicedata', token: SB_TOKEN });
    expect(r2.statusCode).toBe(400);
  });
});

describe('admin controlled retry (mocked FBR)', () => {
  it('admin can retry only an invoice whose previous attempt definitely did not reach FBR', async () => {
    const inv = await validated();
    mock.on(PATHS.postSb, () => ({ status: 401, body: '' }));
    await call(app, s, 'POST', `/api/app/invoices/${inv.id}/submit`, {});
    const admin = await newAdmin(app);
    await verifyAdminMfa(app, admin);
    mock.reset();
    const r = await call(app, admin, 'POST', `/api/admin/invoices/${inv.id}/retry`, { reason: 'token fixed by user' });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().status).toBe('ACCEPTED');
    expect(await prisma.auditLog.count({ where: { action: 'admin.invoice.retry' } })).toBe(1);
    const again = await call(app, admin, 'POST', `/api/admin/invoices/${inv.id}/retry`, { reason: 'again please' });
    expect(again.statusCode).toBe(409);
  });
});

describe('printable output', () => {
  it('PDF for drafts and accepted invoices; QR only after acceptance', async () => {
    const inv = await validated();
    const pdf1 = await call(app, s, 'GET', `/api/app/invoices/${inv.id}/pdf`);
    expect(pdf1.statusCode).toBe(200);
    expect(pdf1.headers['content-type']).toBe('application/pdf');
    expect(pdf1.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    expect((await call(app, s, 'GET', `/api/app/invoices/${inv.id}/qr.svg`)).statusCode).toBe(400);
    await call(app, s, 'POST', `/api/app/invoices/${inv.id}/submit`, {});
    const qr = await call(app, s, 'GET', `/api/app/invoices/${inv.id}/qr.svg`);
    expect(qr.statusCode).toBe(200);
    expect(qr.headers['content-type']).toMatch(/image\/svg\+xml/);
    const pdf2 = await call(app, s, 'GET', `/api/app/invoices/${inv.id}/pdf`);
    expect(pdf2.statusCode).toBe(200);
    expect(pdf2.rawPayload.length).toBeGreaterThan(pdf1.rawPayload.length); // includes DI logo + QR image
  });
});
