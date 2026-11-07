/**
 * Integration: serverless-hosting behaviour (Vercel) — resumable background slices, browser-driven
 * processing, orphan recovery, env-token admin bootstrap, health and cron. FBR is MOCKED.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { MockFbr, PATHS, validValidate, type MockRequest } from './mockFbr';
import { call, cookieFrom, fixClock, getApp, newUser, prisma, realClock, resetDb, saveCredential, xlsxMultipart, type Session } from './helpers';
import { twentyFiveInvoices, workbook } from './excelFixtures';
import { recoverOrphans, runOnce } from '../src/jobs/runner';

const ANON = { 'content-type': 'application/json', 'x-requested-with': 'InvoiceGO' };
const TOKEN = 'test-bootstrap-token-0123456789abcdef';
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
  s = await newUser(app, { ntn: '6666666', businessName: 'Foxtrot' });
  await saveCredential(app, s, 'SANDBOX', 'sandbox-token-foxtrot-01');
});
afterAll(async () => {
  realClock();
  await mock.stop();
  await app.close();
  await prisma.$disconnect();
});

async function uploadFive() {
  const refs = ['INV-001', 'INV-002', 'INV-003', 'INV-004', 'INV-005'];
  const rows = twentyFiveInvoices().filter((r) => refs.includes(String(r.import_ref)));
  const buf = Buffer.from(await (await workbook(rows)).buffer());
  const mp = xlsxMultipart(buf, 'five.xlsx', { environment: 'SANDBOX' });
  const up = await app.inject({ method: 'POST', url: '/api/app/bulk/upload', headers: { cookie: s.cookie, 'x-csrf-token': s.csrf, 'content-type': mp.contentType }, payload: mp.payload });
  expect(up.statusCode, up.body).toBe(201);
  const id = up.json().id as string;
  const d = await call(app, s, 'POST', `/api/app/bulk/jobs/${id}/drafts`, { refs: 'ALL_READY' });
  expect(d.json().results.filter((x: { ok: boolean }) => x.ok)).toHaveLength(5);
  return { id, refs };
}

describe('resumable background work (mocked FBR)', () => {
  it('a bulk validation run split into short time slices validates every invoice exactly once', async () => {
    const { id, refs } = await uploadFive();
    mock.on(PATHS.validateSb, (req: MockRequest) => ({ ...validValidate(req), delayMs: 250 }));
    const q = await call(app, s, 'POST', `/api/app/bulk/jobs/${id}/validate`, { refs });
    expect(q.statusCode, q.body).toBe(200);
    const runId = q.json().runId as string;
    let slices = 0;
    for (;;) {
      const r = await runOnce(300, runId); // ~1 invoice per slice
      if (!r.ran) break;
      slices++;
      if (r.status !== 'QUEUED') break;
      expect(slices).toBeLessThan(20);
    }
    expect(slices).toBeGreaterThan(1);
    expect(mock.calls(PATHS.validateSb)).toHaveLength(5); // no duplicates across slices
    const job = (await call(app, s, 'GET', `/api/app/bulk/jobs/${id}`)).json();
    expect(job.invoices.every((i: { status: string }) => i.status === 'FBR_VALID')).toBe(true);
    const run = await prisma.job.findUniqueOrThrow({ where: { id: runId } });
    expect(run.status).toBe('SUCCEEDED');
  });

  it('the browser-driven /process endpoint submits each validated invoice once and never resubmits', async () => {
    const { id, refs } = await uploadFive();
    await call(app, s, 'POST', `/api/app/bulk/jobs/${id}/validate`, { refs });
    while ((await call(app, s, 'POST', `/api/app/bulk/jobs/${id}/process`, {})).json().ran) {
      /* validation slices */
    }
    const sub = await call(app, s, 'POST', `/api/app/bulk/jobs/${id}/submit`, { refs });
    expect(sub.statusCode, sub.body).toBe(200);
    let p = await call(app, s, 'POST', `/api/app/bulk/jobs/${id}/process`, {});
    expect(p.json()).toMatchObject({ ran: true, status: 'SUCCEEDED' });
    p = await call(app, s, 'POST', `/api/app/bulk/jobs/${id}/process`, {});
    expect(p.json().ran).toBe(false);
    expect(mock.calls(PATHS.postSb)).toHaveLength(5);
    const job = (await call(app, s, 'GET', `/api/app/bulk/jobs/${id}`)).json();
    expect(job.invoices.every((i: { status: string }) => i.status === 'ACCEPTED')).toBe(true);
    // nothing left to submit
    const again = await call(app, s, 'POST', `/api/app/bulk/jobs/${id}/submit`, { refs });
    expect(again.statusCode).toBe(400);
    expect(mock.calls(PATHS.postSb)).toHaveLength(5);
  });

  it('another business cannot drive this upload', async () => {
    const { id } = await uploadFive();
    const other = await newUser(app, { email: 'other@invoicego.test', ntn: '7777777', businessName: 'Golf' });
    const r = await call(app, other, 'POST', `/api/app/bulk/jobs/${id}/process`, {});
    expect(r.statusCode).toBe(404);
  });

  it('orphaned RUNNING jobs are re-queued for resumption', async () => {
    const j = await prisma.job.create({ data: { type: 'bulk.validate', payload: {}, status: 'RUNNING', startedAt: new Date(Date.now() - 60 * 60_000) } });
    await recoverOrphans();
    expect((await prisma.job.findUniqueOrThrow({ where: { id: j.id } })).status).toBe('QUEUED');
  });
});

describe('administrator bootstrap with a server setup token', () => {
  it('works once for the designated email, then closes; 2FA is still required', async () => {
    let st = await app.inject({ method: 'GET', url: '/api/admin/auth/bootstrap-status' });
    expect(st.json()).toEqual({ available: true, email: 'admininvoicego@gmail.com' });
    const bad = await app.inject({ method: 'POST', url: '/api/admin/auth/bootstrap', headers: ANON, payload: { token: 'wrong-token-wrong-token-wrong', name: 'Owner', password: 'AdminPassw0rd99' } });
    expect(bad.statusCode).toBe(401);
    const weak = await app.inject({ method: 'POST', url: '/api/admin/auth/bootstrap', headers: ANON, payload: { token: TOKEN, name: 'Owner', password: 'short1' } });
    expect(weak.statusCode).toBe(400);
    const noCsrf = await app.inject({ method: 'POST', url: '/api/admin/auth/bootstrap', headers: { 'content-type': 'application/json' }, payload: { token: TOKEN, name: 'Owner', password: 'AdminPassw0rd99' } });
    expect(noCsrf.statusCode).toBe(403);
    const ok = await app.inject({ method: 'POST', url: '/api/admin/auth/bootstrap', headers: ANON, payload: { token: TOKEN, name: 'Owner', password: 'AdminPassw0rd99' } });
    expect(ok.statusCode, ok.body).toBe(200);
    const u = await prisma.user.findUniqueOrThrow({ where: { email: 'admininvoicego@gmail.com' } });
    expect(u.platformRole).toBe('SUPER_ADMIN');
    expect(u.totpEnabledAt).toBeNull();

    const login = await app.inject({ method: 'POST', url: '/api/admin/auth/login', headers: ANON, payload: { email: 'admininvoicego@gmail.com', password: 'AdminPassw0rd99' } });
    expect(login.json().mfa).toBe('ENROLL');
    const sess = { cookie: cookieFrom(login, 'ig_admin'), csrf: login.json().csrfToken as string };
    const dash = await call(app, sess, 'GET', '/api/admin/dashboard');
    expect(dash.statusCode).toBe(401);
    expect(dash.json().error.code).toBe('MFA_REQUIRED');

    const again = await app.inject({ method: 'POST', url: '/api/admin/auth/bootstrap', headers: ANON, payload: { token: TOKEN, name: 'Intruder', password: 'AdminPassw0rd99' } });
    expect(again.statusCode).toBe(410);
    st = await app.inject({ method: 'GET', url: '/api/admin/auth/bootstrap-status' });
    expect(st.json().available).toBe(false);
  });
});

describe('health and cron endpoints', () => {
  it('health reports database and reference data', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/health' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ ok: true, db: 'ok', referenceData: true });
  });

  it('cron maintenance requires the cron secret', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/cron/maintenance' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/cron/maintenance', headers: { authorization: 'Bearer nope' } })).statusCode).toBe(401);
    const ok = await app.inject({ method: 'GET', url: '/api/cron/maintenance', headers: { authorization: 'Bearer test-cron-secret-0123456789' } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().ok).toBe(true);
  });
});
