/** Integration: tenant isolation, customers/products CRUD, sandbox workspace (MOCKED FBR). */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { MockFbr, PATHS } from './mockFbr';
import { call, createInvoice, fixClock, getApp, newUser, prisma, realClock, resetDb, saveCredential, xlsxMultipart, type Session } from './helpers';
import { workbook, row } from './excelFixtures';

const mock = new MockFbr();
let app: FastifyInstance;
let A: Session;
let B: Session;

beforeAll(async () => {
  await mock.start();
  app = await getApp();
});
beforeEach(async () => {
  fixClock();
  await resetDb();
  mock.reset();
  A = await newUser(app, { ntn: '1111111', businessName: 'Alpha' });
  B = await newUser(app, { ntn: '2222222', businessName: 'Beta' });
});
afterAll(async () => {
  realClock();
  await mock.stop();
  await app.close();
  await prisma.$disconnect();
});

const customer = { name: 'ABC Traders', ntnCnic: '7654321', province: 'Sindh', address: 'Karachi', registrationType: 'REGISTERED' };
const product = { sku: 'P-001', description: 'Product A', hsCode: '0101.2100', uom: 'Numbers, pieces, units', saleType: 'Goods at standard rate (default)', rate: '18%', unitPrice: '1000' };

describe('tenant isolation: business B can never reach business A records', () => {
  it('invoices, customers, products, import jobs, tickets and attachments return 404 across tenants', async () => {
    const inv = await createInvoice(app, A);
    const c = (await call(app, A, 'POST', '/api/app/customers', customer)).json();
    const p = (await call(app, A, 'POST', '/api/app/products', product)).json();
    const { buffer } = await workbook([row('X-1', { invoice_date: '2026-11-15' })]);
    const mp = xlsxMultipart(await buffer(), 'a.xlsx', { environment: 'SANDBOX' });
    const job = await app.inject({ method: 'POST', url: '/api/app/bulk/upload', headers: { cookie: A.cookie, 'x-csrf-token': A.csrf, 'content-type': mp.contentType }, payload: mp.payload });
    expect(job.statusCode, job.body).toBe(201);
    const t = (await call(app, A, 'POST', '/api/app/support/tickets', { title: 'Need help', description: 'Something is not working', category: 'TECHNICAL', queryType: 'INTEGRATION' })).json();
    const pdf = Buffer.from('%PDF-1.4\n%test\n');
    const boundary = 'xyzboundary';
    const body = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="doc.pdf"\r\nContent-Type: application/pdf\r\n\r\n`), pdf, Buffer.from(`\r\n--${boundary}--\r\n`)]);
    const att = await app.inject({ method: 'POST', url: `/api/app/support/tickets/${t.id}/attachments`, headers: { cookie: A.cookie, 'x-csrf-token': A.csrf, 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: body });
    expect(att.statusCode, att.body).toBe(200);
    const attId = att.json().attachments[0].id;

    const probes: [string, string, unknown?][] = [
      ['GET', `/api/app/invoices/${inv.id}`],
      ['PUT', `/api/app/invoices/${inv.id}`, { invoiceDate: '2026-11-15', buyerBusinessName: 'x', buyerProvince: 'x', buyerAddress: 'x', buyerRegistrationType: 'UNREGISTERED', items: [{ saleType: 'x', hsCode: '0101.2100', productDescription: 'x', rate: '18%', uom: 'x', quantity: '1', unitPrice: '1' }] }],
      ['DELETE', `/api/app/invoices/${inv.id}`],
      ['POST', `/api/app/invoices/${inv.id}/validate`, {}],
      ['POST', `/api/app/invoices/${inv.id}/submit`, {}],
      ['GET', `/api/app/invoices/${inv.id}/pdf`],
      ['GET', `/api/app/invoices/${inv.id}/payload`],
      ['GET', `/api/app/customers/${c.id}`],
      ['PUT', `/api/app/customers/${c.id}`, customer],
      ['DELETE', `/api/app/customers/${c.id}`],
      ['GET', `/api/app/products/${p.id}`],
      ['PUT', `/api/app/products/${p.id}`, product],
      ['DELETE', `/api/app/products/${p.id}`],
      ['GET', `/api/app/bulk/jobs/${job.json().id}`],
      ['GET', `/api/app/support/tickets/${t.id}`],
      ['GET', `/api/app/support/attachments/${attId}`],
    ];
    for (const [m, url, payload] of probes) {
      const r = await call(app, B, m, url, payload);
      expect(r.statusCode, `${m} ${url}`).toBe(404);
    }
    // B's listings do not include A's data
    expect((await call(app, B, 'GET', '/api/app/invoices')).json().total).toBe(0);
    expect((await call(app, B, 'GET', '/api/app/customers')).json().total).toBe(0);
    expect((await call(app, B, 'GET', '/api/app/bulk/jobs')).json()).toHaveLength(0);
    // A's records are untouched
    expect((await call(app, A, 'GET', `/api/app/invoices/${inv.id}`)).statusCode).toBe(200);
    expect((await call(app, A, 'GET', `/api/app/customers/${c.id}`)).statusCode).toBe(200);
  });

  it('an invoice cannot reference another tenant\'s customer', async () => {
    const c = (await call(app, A, 'POST', '/api/app/customers', customer)).json();
    const r = await call(app, B, 'POST', '/api/app/invoices', { environment: 'SANDBOX', invoiceDate: '2026-11-15', scenarioId: 'SN001', customerId: c.id, buyerBusinessName: 'x', buyerProvince: 'Sindh', buyerAddress: 'x', buyerRegistrationType: 'UNREGISTERED', items: [{ saleType: 'Goods at standard rate (default)', hsCode: '0101.2100', productDescription: 'x', rate: '18%', uom: 'Numbers, pieces, units', quantity: '1', unitPrice: '1' }] });
    expect(r.statusCode).toBe(404);
  });
});

describe('customers and products', () => {
  it('customer add, view, edit, search, delete', async () => {
    const created = await call(app, A, 'POST', '/api/app/customers', customer);
    expect(created.statusCode).toBe(201);
    const id = created.json().id;
    expect((await call(app, A, 'GET', `/api/app/customers/${id}`)).json()).toMatchObject({ name: 'ABC Traders', ntnCnic: '7654321' });
    const upd = await call(app, A, 'PUT', `/api/app/customers/${id}`, { ...customer, name: 'ABC Traders (Pvt) Ltd' });
    expect(upd.json().name).toBe('ABC Traders (Pvt) Ltd');
    expect((await call(app, A, 'GET', '/api/app/customers?q=pvt')).json().total).toBe(1);
    expect((await call(app, A, 'GET', '/api/app/customers?q=7654')).json().total).toBe(1);
    const reg = await call(app, A, 'POST', '/api/app/customers', { ...customer, ntnCnic: '' });
    expect(reg.statusCode).toBe(400); // registered buyers need NTN/CNIC
    const dup = await call(app, A, 'POST', '/api/app/customers', customer);
    expect(dup.statusCode).toBe(409);
    expect((await call(app, A, 'DELETE', `/api/app/customers/${id}`)).statusCode).toBe(200);
    expect((await call(app, A, 'GET', `/api/app/customers/${id}`)).statusCode).toBe(404);
  });

  it('customer NTN/CNIC keeps leading zeros', async () => {
    const r = await call(app, A, 'POST', '/api/app/customers', { ...customer, ntnCnic: '0012345' });
    expect(r.json().ntnCnic).toBe('0012345');
  });

  it('product add, view, edit (SKU unique), delete; unknown HS code warns', async () => {
    const created = await call(app, A, 'POST', '/api/app/products', product);
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ sku: 'P-001', hsCode: '0101.2100', uom: 'Numbers, pieces, units', saleType: 'Goods at standard rate (default)', unitPrice: '1000', warning: null });
    const id = created.json().id;
    expect((await call(app, A, 'POST', '/api/app/products', product)).statusCode).toBe(409);
    const upd = await call(app, A, 'PUT', `/api/app/products/${id}`, { ...product, unitPrice: '1250.50', hsCode: '9999.9999' });
    expect(upd.json()).toMatchObject({ unitPrice: '1250.5', warning: expect.stringMatching(/not in the supplied PCT\/HS catalogue/) });
    expect((await call(app, A, 'POST', '/api/app/products', { ...product, sku: 'P-2', hsCode: '101.21' })).statusCode).toBe(400);
    expect((await call(app, A, 'DELETE', `/api/app/products/${id}`)).statusCode).toBe(200);
    expect((await call(app, A, 'GET', '/api/app/products')).json().total).toBe(0);
  });

  it('editing a customer does not change the buyer snapshot of an accepted invoice (mocked FBR)', async () => {
    await saveCredential(app, A, 'SANDBOX', 'sandbox-token-for-alpha-0001');
    const c = (await call(app, A, 'POST', '/api/app/customers', customer)).json();
    const inv = await createInvoice(app, A, { customerId: c.id });
    expect((await call(app, A, 'POST', `/api/app/invoices/${inv.id}/validate`, {})).json().outcome).toBe('VALID');
    expect((await call(app, A, 'POST', `/api/app/invoices/${inv.id}/submit`, {})).json().invoice.status).toBe('ACCEPTED');
    await call(app, A, 'PUT', `/api/app/customers/${c.id}`, { ...customer, name: 'Renamed Buyer', address: 'Hyderabad' });
    await call(app, A, 'DELETE', `/api/app/customers/${c.id}`);
    const after = (await call(app, A, 'GET', `/api/app/invoices/${inv.id}`)).json();
    expect(after).toMatchObject({ buyerBusinessName: 'ABC Traders', buyerAddress: 'Karachi', status: 'ACCEPTED' });
  });

  it('HS catalogue search by code (with or without dot) and by description', async () => {
    expect((await call(app, A, 'GET', '/api/app/hs-codes?q=0101.21')).json().rows[0].code).toBe('0101.2100');
    expect((await call(app, A, 'GET', '/api/app/hs-codes?q=01012100')).json()).toMatchObject({ total: 1, matchedBy: 'code' });
    const d = (await call(app, A, 'GET', '/api/app/hs-codes?q=basmati')).json();
    expect(d.matchedBy).toBe('description');
    expect(d.rows[0].code).toBe('1006.3010');
    expect((await call(app, A, 'GET', '/api/app/hs-codes?pageSize=100&page=2')).json().rows).toHaveLength(100);
  });
});

describe('sandbox workspace (mocked FBR)', () => {
  it('lists 28 scenarios with applicability; template is prepared with the business seller and today', async () => {
    const list = (await call(app, A, 'GET', '/api/app/sandbox/scenarios')).json();
    expect(list.scenarios).toHaveLength(28);
    expect(list.summary.required).toBe(11); // Manufacturer + All Other Sectors
    const t = (await call(app, A, 'GET', '/api/app/sandbox/scenarios/SN005/template')).json();
    expect(t.prepared).toMatchObject({ sellerNTNCNIC: '1111111', sellerBusinessName: 'Alpha', invoiceDate: '2026-11-15', scenarioId: 'SN005' });
    expect(t.original.raw).toContain('"invoiceDate": "2025-06-30"');
  });

  it('edited JSON is saved, validated and submitted to the sandbox URL; values are not recalculated', async () => {
    await saveCredential(app, A, 'SANDBOX', 'sandbox-token-for-alpha-0001');
    const t = (await call(app, A, 'GET', '/api/app/sandbox/scenarios/SN005/template')).json();
    const wrongScenario = await call(app, A, 'POST', '/api/app/sandbox/run', { scenarioId: 'SN006', payload: t.prepared });
    expect(wrongScenario.statusCode).toBe(422);
    const prevMonth = await call(app, A, 'POST', '/api/app/sandbox/run', { scenarioId: 'SN005', payload: { ...t.prepared, invoiceDate: '2025-06-30' } });
    expect(prevMonth.statusCode).toBe(422);
    expect(prevMonth.json().error.message).toBe("You can't create future or previous month invoices");
    const run = await call(app, A, 'POST', '/api/app/sandbox/run', { scenarioId: 'SN005', payload: t.prepared });
    expect(run.statusCode, run.body).toBe(200);
    const inv = run.json().invoice;
    expect(inv).toMatchObject({ environment: 'SANDBOX', scenarioId: 'SN005', autoCalc: false });
    expect(inv.items[0]).toMatchObject({ salesTaxApplicable: '10', discount: '56.36', fedPayable: '50.36', sroItemSerialNo: '82' });
    expect((await call(app, A, 'POST', `/api/app/invoices/${inv.id}/validate`, {})).json().outcome).toBe('VALID');
    const sub = (await call(app, A, 'POST', `/api/app/invoices/${inv.id}/submit`, {})).json();
    expect(sub.invoice.status).toBe('ACCEPTED');
    const sent = mock.calls(PATHS.postSb)[0].json;
    expect(sent).toMatchObject({ scenarioId: 'SN005', sellerNTNCNIC: '1111111' });
    expect(sent.items[0]).toMatchObject({ discount: 56.36, salesTaxWithheldAtSource: 50.23, sroScheduleNo: 'EIGHTH SCHEDULE Table 1', extraTax: 0 });
    const list = (await call(app, A, 'GET', '/api/app/sandbox/scenarios')).json();
    expect(list.scenarios.find((x: { id: string }) => x.id === 'SN005').progress.status).toBe('PASSED');
    const attempts = (await call(app, A, 'GET', '/api/app/sandbox/scenarios/SN005/attempts')).json();
    expect(attempts.map((a: { operation: string }) => a.operation)).toEqual(['POST', 'VALIDATE']);
    // a new run after acceptance creates a new invoice (accepted one stays immutable)
    const run2 = await call(app, A, 'POST', '/api/app/sandbox/run', { scenarioId: 'SN005', payload: t.prepared, invoiceId: inv.id });
    expect(run2.json().invoice.id).not.toBe(inv.id);
  });
});
