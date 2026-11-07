/** Integration: Excel bulk upload -> drafts -> FBR validation -> submission, against a MOCKED FBR gateway. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import ExcelJS from 'exceljs';
import { MockFbr, PATHS, itemInvalid, validPost, validValidate, type MockRequest } from './mockFbr';
import { call, fixClock, getApp, newUser, prisma, realClock, resetDb, saveCredential, xlsxMultipart, type Session } from './helpers';
import { row, twentyFiveInvoices, workbook } from './excelFixtures';
import { registerBulkJobs } from '../src/modules/bulk/service';
import { runOnce } from '../src/jobs/runner';

const MSG = "You can't create future or previous month invoices";
const mock = new MockFbr();
let app: FastifyInstance;
let s: Session;

beforeAll(async () => {
  registerBulkJobs();
  await mock.start();
  app = await getApp();
});
beforeEach(async () => {
  fixClock();
  await resetDb();
  mock.reset();
  s = await newUser(app, { ntn: '3333333', businessName: 'Gamma' });
  await saveCredential(app, s, 'SANDBOX', 'sandbox-token-gamma-777');
});
afterAll(async () => {
  realClock();
  await mock.stop();
  await app.close();
  await prisma.$disconnect();
});

let lastBuffer: Buffer | null = null;
async function upload(rows: Record<string, unknown>[] | Buffer) {
  const buf = Buffer.isBuffer(rows) ? rows : await (await workbook(rows)).buffer();
  lastBuffer = buf;
  const mp = xlsxMultipart(buf, 'batch.xlsx', { environment: 'SANDBOX' });
  const r = await app.inject({ method: 'POST', url: '/api/app/bulk/upload', headers: { cookie: s.cookie, 'x-csrf-token': s.csrf, 'content-type': mp.contentType }, payload: mp.payload });
  expect(r.statusCode, r.body).toBe(201);
  return r.json().id as string;
}
const job = async (id: string) => (await call(app, s, 'GET', `/api/app/bulk/jobs/${id}`)).json();
async function drain() {
  while ((await runOnce()).ran) {
    /* run queued jobs synchronously (worker disabled in tests) */
  }
}

describe('Excel bulk workflow (mocked FBR)', () => {
  it('template download is an xlsx workbook', async () => {
    const r = await call(app, s, 'GET', '/api/app/bulk/template');
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toMatch(/spreadsheetml/);
  });

  it('uploads 25 multi-line invoices; invalid ones are flagged per invoice/row; partial results are never "all success"', async () => {
    const rows = twentyFiveInvoices();
    rows.find((r) => r.import_ref === 'INV-003')!.invoice_date = '2026-10-31';
    rows.find((r) => r.import_ref === 'INV-004')!.hs_code = '0101-2100';
    const id = await upload(rows);
    const lastFirstUpload = lastBuffer;
    let j = await job(id);
    expect(j.totalInvoices).toBe(25);
    const byRef = (ref: string) => j.invoices.find((i: { importRef: string }) => i.importRef === ref);
    expect(byRef('INV-003').status).toBe('LOCAL_INVALID');
    expect(byRef('INV-003').errors).toContainEqual(expect.objectContaining({ field: 'invoice_date', message: MSG, row: expect.any(Number) }));
    expect(byRef('INV-004').status).toBe('LOCAL_INVALID');
    expect(byRef('INV-004').errors.some((e: { field: string; row: number }) => e.field === 'hs_code' && e.row > 1)).toBe(true);
    expect(j.counts).toMatchObject({ READY: 23, LOCAL_INVALID: 2 });

    // drafts for the locally valid invoices
    const d = await call(app, s, 'POST', `/api/app/bulk/jobs/${id}/drafts`, { refs: 'ALL_READY' });
    expect(d.json().results.filter((x: { ok: boolean }) => x.ok)).toHaveLength(23);
    j = await job(id);
    const refs = j.invoices.filter((i: { status: string }) => i.status === 'DRAFT_CREATED').map((i: { importRef: string }) => i.importRef);
    expect(refs).toHaveLength(23);

    // FBR validation: invoices whose first item mentions "Item A 7" or "Item A 9" are rejected at item level
    const bad = (req: MockRequest) => /Item A (7|9)$/.test(req.json.items[0].productDescription);
    mock.on(PATHS.validateSb, (req) => (bad(req) ? itemInvalid(req) : validValidate(req)));
    const v = await call(app, s, 'POST', `/api/app/bulk/jobs/${id}/validate`, { refs });
    expect(v.json().queued).toBe(23);
    expect((await call(app, s, 'POST', `/api/app/bulk/jobs/${id}/validate`, { refs })).statusCode).toBe(409); // already running
    await drain();
    j = await job(id);
    expect(j.counts).toMatchObject({ FBR_VALID: 21, FBR_INVALID: 2 });
    expect(byRef.call(null, 'INV-007')).toBeDefined();
    const inv7 = j.invoices.find((i: { importRef: string }) => i.importRef === 'INV-007');
    expect(inv7.errors[0]).toMatchObject({ fbrCode: '0046', level: 'error' });

    // submit everything selected; only FBR-valid ones are eligible; one gets rejected on post
    mock.on(PATHS.postSb, (req) => (/Item A 11$/.test(req.json.items[0].productDescription) ? itemInvalid(req) : validPost(req)));
    const sub = await call(app, s, 'POST', `/api/app/bulk/jobs/${id}/submit`, { refs });
    expect(sub.json()).toMatchObject({ queued: 21, skipped: 2 });
    await drain();
    j = await job(id);
    expect(j.counts).toMatchObject({ ACCEPTED: 20, REJECTED: 1, FBR_INVALID: 2, LOCAL_INVALID: 2 });
    expect(j.status).toBe('COMPLETED');
    expect(mock.calls(PATHS.postSb)).toHaveLength(21);
    const accepted = j.invoices.filter((i: { status: string }) => i.status === 'ACCEPTED');
    expect(accepted.every((i: { invoice: { fbrInvoiceNumber: string } }) => /DI\d+/.test(i.invoice.fbrInvoiceNumber))).toBe(true);

    // re-submitting never re-posts accepted invoices
    const again = await call(app, s, 'POST', `/api/app/bulk/jobs/${id}/submit`, { refs });
    expect(again.statusCode).toBe(400);
    expect(mock.calls(PATHS.postSb)).toHaveLength(21);

    // a re-upload of the same file skips already-accepted import refs
    const id2 = await upload(lastFirstUpload!);
    const j2 = await job(id2);
    expect(j2.counts.SKIPPED_DUPLICATE).toBe(20);
    expect((j2.fileErrors as { message: string }[]).some((f) => /already uploaded/.test(f.message))).toBe(true);

    // downloadable error report
    const rep = await call(app, s, 'GET', `/api/app/bulk/jobs/${id}/errors.xlsx`);
    expect(rep.statusCode).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(rep.rawPayload as never);
    const sheet = wb.getWorksheet('Errors')!;
    const refsInReport = new Set<string>();
    sheet.eachRow((r, n) => n > 1 && refsInReport.add(String(r.getCell(1).value)));
    expect([...refsInReport]).toEqual(expect.arrayContaining(['INV-003', 'INV-004', 'INV-007', 'INV-009', 'INV-011']));
  });

  it('rejects non-xlsx uploads and files with missing columns', async () => {
    const mp = xlsxMultipart(Buffer.from('not a workbook'), 'x.xlsx', { environment: 'SANDBOX' });
    const r = await app.inject({ method: 'POST', url: '/api/app/bulk/upload', headers: { cookie: s.cookie, 'x-csrf-token': s.csrf, 'content-type': mp.contentType }, payload: mp.payload });
    expect(r.statusCode).toBe(400);
    const mp2 = xlsxMultipart(Buffer.from('PKfake'), 'x.csv', { environment: 'SANDBOX' });
    const r2 = await app.inject({ method: 'POST', url: '/api/app/bulk/upload', headers: { cookie: s.cookie, 'x-csrf-token': s.csrf, 'content-type': mp2.contentType }, payload: mp2.payload });
    expect(r2.statusCode).toBe(400);
    const id = await upload([row('ONLY-1', { scenario_id: '' })]);
    expect((await job(id)).invoices[0].status).toBe('LOCAL_INVALID');
  });

  it('production uploads are refused while production is not enabled', async () => {
    const { buffer } = await workbook([row('P-1')]);
    const mp = xlsxMultipart(await buffer(), 'p.xlsx', { environment: 'PRODUCTION' });
    const r = await app.inject({ method: 'POST', url: '/api/app/bulk/upload', headers: { cookie: s.cookie, 'x-csrf-token': s.csrf, 'content-type': mp.contentType }, payload: mp.payload });
    expect(r.statusCode).toBe(409);
  });
});
