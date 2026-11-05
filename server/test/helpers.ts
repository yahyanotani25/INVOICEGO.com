import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { authenticator } from 'otplib';
import { buildApp } from '../src/app';
import { prisma } from '../src/db';
import { __setClock, karachiNow } from '../src/lib/time';
import { issueEmailToken } from '../src/modules/auth/routes';
import { createAdminInvite } from '../src/modules/admin/invite';
import { decryptSecret } from '../src/lib/crypto';
import { URLS } from './mockFbr';

/** Fixed trusted clock for deterministic month-rule behaviour: 15 Nov 2026 12:00 PKT. */
export const FIXED_NOW = new Date('2026-11-15T07:00:00.000Z');
export function fixClock(d: Date = FIXED_NOW) {
  __setClock(() => d);
}
export function realClock() {
  __setClock(null);
}
export const today = () => karachiNow().date;

const TENANT_TABLES = [
  'TicketAttachment', 'TicketMessage', 'SupportTicket', 'ImportInvoice', 'ImportJob', 'Job', 'InvoiceSnapshot', 'InvoiceItem', 'FbrAttempt', 'Invoice',
  'BuyerVerification', 'ScenarioProgress', 'Customer', 'Product', 'FbrCredential', 'OnboardingProfile', 'Membership', 'Business', 'Session', 'EmailToken',
  'LoginEvent', 'Notification', 'Announcement', 'AuditLog', 'SystemSetting', 'BackupRecord', 'ReferenceCache', 'User',
];

export async function resetDb() {
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${TENANT_TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`);
}

let appP: Promise<FastifyInstance> | null = null;
export async function getApp() {
  appP ??= buildApp().then(async (a) => {
    await a.ready();
    return a;
  });
  return appP;
}

export interface Session {
  cookie: string;
  csrf: string;
  userId: string;
  businessId: string;
  email: string;
}

const ANON = { 'content-type': 'application/json', 'x-requested-with': 'InvoiceGO' };

export function cookieFrom(res: LightMyRequestResponse, name: string) {
  const c = res.cookies.find((x) => x.name === name);
  if (!c) throw new Error(`cookie ${name} not set (status ${res.statusCode}: ${res.body})`);
  return `${name}=${c.value}`;
}

let seq = 0;
export async function registerUser(app: FastifyInstance, opts: { email?: string; ntn?: string; businessName?: string; activities?: string[]; sector?: string; retailer?: boolean } = {}) {
  seq++;
  const email = opts.email ?? `user${seq}-${Date.now()}@example.com`;
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    headers: ANON,
    payload: {
      name: 'Test User',
      email,
      phone: '03001234567',
      password: 'Passw0rd1234',
      business: { name: opts.businessName ?? `Biz ${seq}`, ntnCnic: opts.ntn ?? String(1000000 + seq), strn: '', address: 'Mall Road, Lahore', province: 'Punjab', businessActivities: opts.activities ?? ['Manufacturer'], sector: opts.sector ?? 'All Other Sectors', retailerRegistered: !!opts.retailer },
    },
  });
  if (res.statusCode !== 201) throw new Error(`register failed ${res.statusCode} ${res.body}`);
  return email;
}

export async function verifyEmail(app: FastifyInstance, email: string) {
  const u = await prisma.user.findUniqueOrThrow({ where: { email } });
  const token = await issueEmailToken(u.id, 'VERIFY_EMAIL', 1);
  const res = await app.inject({ method: 'POST', url: '/api/auth/verify-email', headers: ANON, payload: { token } });
  if (res.statusCode !== 200) throw new Error(`verify failed ${res.body}`);
}

export async function login(app: FastifyInstance, email: string, password = 'Passw0rd1234'): Promise<Session> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', headers: ANON, payload: { email, password } });
  if (res.statusCode !== 200) throw new Error(`login failed ${res.statusCode} ${res.body}`);
  const me = res.json();
  return { cookie: cookieFrom(res, 'ig_session'), csrf: me.csrfToken, userId: me.user.id, businessId: me.business.id, email };
}

export async function newUser(app: FastifyInstance, opts: Parameters<typeof registerUser>[1] = {}) {
  const email = await registerUser(app, opts);
  await verifyEmail(app, email);
  return login(app, email);
}

export function call(app: FastifyInstance, s: { cookie: string; csrf: string } | null, method: string, url: string, payload?: unknown, extraHeaders: Record<string, string> = {}) {
  return app.inject({
    method: method as never,
    url,
    headers: { ...(s ? { cookie: s.cookie, 'x-csrf-token': s.csrf } : {}), ...(payload !== undefined ? { 'content-type': 'application/json' } : {}), ...extraHeaders },
    payload: payload === undefined ? undefined : JSON.stringify(payload),
  });
}

export async function saveCredential(app: FastifyInstance, s: Session, env: 'SANDBOX' | 'PRODUCTION', token: string) {
  const res = await call(app, s, 'PUT', `/api/app/fbr/credentials/${env.toLowerCase()}`, { ...URLS[env], token });
  if (res.statusCode !== 200) throw new Error(`credential save failed ${res.body}`);
  return res;
}

export function invoiceBody(over: Record<string, unknown> = {}, item: Record<string, unknown> = {}) {
  return {
    environment: 'SANDBOX',
    invoiceType: 'SALE_INVOICE',
    invoiceDate: today(),
    paymentMode: 'Cash',
    scenarioId: 'SN001',
    buyerNtnCnic: '7654321',
    buyerBusinessName: 'ABC Traders',
    buyerProvince: 'Sindh',
    buyerAddress: 'Karachi',
    buyerRegistrationType: 'REGISTERED',
    items: [
      { saleType: 'Goods at standard rate (default)', hsCode: '0101.2100', productDescription: 'Product A', rate: '18%', uom: 'Numbers, pieces, units', quantity: '10', unitPrice: '1000', discount: '0', ...item },
    ],
    ...over,
  };
}

export async function createInvoice(app: FastifyInstance, s: Session, over: Record<string, unknown> = {}, item: Record<string, unknown> = {}) {
  const res = await call(app, s, 'POST', '/api/app/invoices', invoiceBody(over, item));
  if (res.statusCode !== 201) throw new Error(`invoice create failed ${res.statusCode} ${res.body}`);
  return res.json().invoice as { id: string; status: string; [k: string]: any };
}

/** Admin bootstrap through the real invitation + TOTP flow. */
export async function newAdmin(app: FastifyInstance, role: 'SUPER_ADMIN' | 'ADMIN' | 'SUPPORT' | 'AUDITOR' = 'SUPER_ADMIN', email = `admin-${Date.now()}@invoicego.test`) {
  const inv = await createAdminInvite(email, role);
  const token = new URL(inv.url).searchParams.get('token')!;
  const acc = await app.inject({ method: 'POST', url: '/api/admin/auth/accept-invite', headers: ANON, payload: { token, name: 'Admin Person', password: 'AdminPassw0rd99' } });
  if (acc.statusCode !== 200) throw new Error(`accept invite failed ${acc.body}`);
  const lg = await app.inject({ method: 'POST', url: '/api/admin/auth/login', headers: ANON, payload: { email, password: 'AdminPassw0rd99' } });
  if (lg.statusCode !== 200) throw new Error(`admin login failed ${lg.body}`);
  const s = { cookie: cookieFrom(lg, 'ig_admin'), csrf: lg.json().csrfToken as string };
  const setup = await call(app, s, 'POST', '/api/admin/auth/totp/setup', {});
  if (setup.statusCode !== 200) throw new Error(`totp setup failed ${setup.body}`);
  return { ...s, email, userId: inv.userId, mfaVerified: false };
}

export async function verifyAdminMfa(app: FastifyInstance, s: { cookie: string; csrf: string; userId: string }) {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: s.userId } });
  const code = authenticator.generate(decryptSecret(u.totpSecretEnc!));
  const res = await call(app, s, 'POST', u.totpEnabledAt ? '/api/admin/auth/totp/verify' : '/api/admin/auth/totp/enable', { code });
  if (res.statusCode !== 200) throw new Error(`mfa failed ${res.body}`);
}

export function xlsxMultipart(buf: Buffer, filename: string, fields: Record<string, string>) {
  const boundary = '----invoicegotest' + Math.random().toString(16).slice(2);
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n`));
  parts.push(buf);
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  return { payload: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

export { prisma };
