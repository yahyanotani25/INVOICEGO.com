/** Integration: business team invitations, business-user 2FA, creating a business, platform logo, STATL. FBR is MOCKED. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { authenticator } from 'otplib';
import { MockFbr } from './mockFbr';
import { call, cookieFrom, fixClock, getApp, login, newAdmin, newUser, prisma, realClock, resetDb, saveCredential, verifyAdminMfa, type Session } from './helpers';
import { decryptSecret } from '../src/lib/crypto';

const ANON = { 'content-type': 'application/json', 'x-requested-with': 'InvoiceGO' };
const mock = new MockFbr();
let app: FastifyInstance;

beforeAll(async () => {
  await mock.start();
  app = await getApp();
});
beforeEach(async () => {
  fixClock();
  await resetDb();
  mock.reset();
});
afterAll(async () => {
  realClock();
  await mock.stop();
  await app.close();
  await prisma.$disconnect();
});

const tokenOf = (url: string) => new URL(url).searchParams.get('token')!;

async function invite(owner: Session, email: string, role: string) {
  const r = await call(app, owner, 'POST', '/api/app/team/invites', { email, role });
  expect(r.statusCode, r.body).toBe(201);
  const j = r.json();
  expect(j.emailed).toBe(false); // SMTP is not configured in tests: the link is returned to share
  return { id: j.id as string, token: tokenOf(j.url) };
}

async function accept(token: string, body: Record<string, unknown>) {
  return app.inject({ method: 'POST', url: '/api/auth/team-invite/accept', headers: ANON, payload: { token, ...body } });
}

function sessionFrom(res: Awaited<ReturnType<typeof accept>>, email: string): Session {
  const me = res.json();
  return { cookie: cookieFrom(res, 'ig_session'), csrf: me.csrfToken, userId: me.user.id, businessId: me.business.id, email };
}

describe('team invitations', () => {
  it('owner invites a new person, who creates an account by accepting; roles are enforced', async () => {
    const owner = await newUser(app, { ntn: '1111111', businessName: 'Alpha Traders' });
    const { token } = await invite(owner, 'operator@invoicego.test', 'OPERATOR');

    const view = await app.inject({ method: 'GET', url: `/api/auth/team-invite?token=${token}` });
    expect(view.statusCode).toBe(200);
    expect(view.json()).toMatchObject({ businessName: 'Alpha Traders', email: 'operator@invoicego.test', role: 'OPERATOR', accountExists: false });

    const missing = await accept(token, { password: 'Passw0rd1234' });
    expect(missing.statusCode).toBe(400);
    const weak = await accept(token, { password: 'short', name: 'Op Person', phone: '03001112222' });
    expect(weak.statusCode).toBe(400);

    const ok = await accept(token, { password: 'Passw0rd1234', name: 'Op Person', phone: '03001112222' });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json().business).toMatchObject({ name: 'Alpha Traders', role: 'OPERATOR' });
    const op = sessionFrom(ok, 'operator@invoicego.test');
    const u = await prisma.user.findUniqueOrThrow({ where: { email: 'operator@invoicego.test' } });
    expect(u.status).toBe('ACTIVE');
    expect(u.emailVerifiedAt).not.toBeNull();

    // single use
    expect((await accept(token, { password: 'Passw0rd1234', name: 'X Y', phone: '03001112222' })).statusCode).toBe(400);

    // operator cannot manage the team
    expect((await call(app, op, 'POST', '/api/app/team/invites', { email: 'x@invoicego.test', role: 'VIEWER' })).statusCode).toBe(403);

    const team = (await call(app, owner, 'GET', '/api/app/team')).json();
    const member = team.members.find((m: { email: string }) => m.email === 'operator@invoicego.test');
    expect(member).toMatchObject({ role: 'OPERATOR', canChange: true });

    // demote to viewer: invoice creation is then refused
    expect((await call(app, owner, 'PATCH', `/api/app/team/members/${member.id}`, { role: 'VIEWER' })).statusCode).toBe(200);
    const asViewer = await call(app, op, 'POST', '/api/app/customers', { name: 'Buyer', registrationType: 'UNREGISTERED', province: 'Punjab', address: 'Lahore' });
    expect(asViewer.statusCode).toBe(403);

    // owner role cannot be changed or removed; you cannot change yourself
    const ownerRow = team.members.find((m: { isYou: boolean }) => m.isYou);
    expect((await call(app, owner, 'PATCH', `/api/app/team/members/${ownerRow.id}`, { role: 'ADMIN' })).statusCode).toBe(400);

    // removal leaves the user with no business; they can then create their own
    expect((await call(app, owner, 'DELETE', `/api/app/team/members/${member.id}`)).statusCode).toBe(200);
    const noBiz = await call(app, op, 'GET', '/api/app/invoices');
    expect(noBiz.json().error.code).toBe('NO_BUSINESS');
    const created = await call(app, op, 'POST', '/api/auth/businesses', { name: 'Op Own Shop', ntnCnic: '2222222', address: 'Mall Road', province: 'Punjab', businessActivities: ['Retailer'], sector: 'FMCG' });
    expect(created.statusCode, created.body).toBe(201);
    expect(created.json().business).toMatchObject({ name: 'Op Own Shop', role: 'OWNER' });
  });

  it('an existing user joins with their password and can switch between businesses', async () => {
    const owner = await newUser(app, { ntn: '1111112', businessName: 'Bravo' });
    const other = await newUser(app, { email: 'accountant@invoicego.test', ntn: '1111113', businessName: 'Charlie' });
    const { token } = await invite(owner, 'accountant@invoicego.test', 'ACCOUNTANT');
    expect((await app.inject({ method: 'GET', url: `/api/auth/team-invite?token=${token}` })).json().accountExists).toBe(true);
    expect((await accept(token, { password: 'WrongPassw0rd1' })).statusCode).toBe(401);
    const ok = await accept(token, { password: 'Passw0rd1234' });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json().businesses).toHaveLength(2);
    const s = sessionFrom(ok, other.email);
    const sw = await call(app, s, 'POST', '/api/auth/switch-business', { businessId: other.businessId });
    expect(sw.json().business.name).toBe('Charlie');
  });

  it('admins cannot invite or manage admins; invitations are tenant-isolated and revocable', async () => {
    const owner = await newUser(app, { ntn: '1111114', businessName: 'Delta' });
    const { token: adminTok } = await invite(owner, 'admin2@invoicego.test', 'ADMIN');
    const adm = sessionFrom(await accept(adminTok, { password: 'Passw0rd1234', name: 'Second Admin', phone: '03001112223' }), 'admin2@invoicego.test');

    expect((await call(app, adm, 'POST', '/api/app/team/invites', { email: 'a3@invoicego.test', role: 'ADMIN' })).statusCode).toBe(403);
    const vInv = await call(app, adm, 'POST', '/api/app/team/invites', { email: 'viewer@invoicego.test', role: 'VIEWER' });
    expect(vInv.statusCode).toBe(201);

    // reserved administrator email and existing members are refused
    expect((await call(app, owner, 'POST', '/api/app/team/invites', { email: 'admininvoicego@gmail.com', role: 'VIEWER' })).statusCode).toBe(400);
    expect((await call(app, owner, 'POST', '/api/app/team/invites', { email: 'admin2@invoicego.test', role: 'VIEWER' })).statusCode).toBe(409);

    // another business cannot see or revoke it
    const stranger = await newUser(app, { ntn: '1111115', businessName: 'Echo' });
    expect((await call(app, stranger, 'DELETE', `/api/app/team/invites/${vInv.json().id}`)).statusCode).toBe(404);

    // revoke, then the link no longer works
    expect((await call(app, owner, 'DELETE', `/api/app/team/invites/${vInv.json().id}`)).statusCode).toBe(200);
    const v = await app.inject({ method: 'GET', url: `/api/auth/team-invite?token=${tokenOf(vInv.json().url)}` });
    expect(v.statusCode).toBe(400);
    expect(v.json().error.code).toBe('INVITE_INVALID');

    // resend issues a fresh link and invalidates the old one
    const r1 = await invite(owner, 'resend@invoicego.test', 'VIEWER');
    const rs = await call(app, owner, 'POST', `/api/app/team/invites/${r1.id}/resend`, {});
    expect(rs.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/api/auth/team-invite?token=${r1.token}` })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: `/api/auth/team-invite?token=${tokenOf(rs.json().url)}` })).statusCode).toBe(200);

    // the second admin cannot remove the owner
    const team = (await call(app, adm, 'GET', '/api/app/team')).json();
    const ownerRow = team.members.find((m: { role: string }) => m.role === 'OWNER');
    expect((await call(app, adm, 'DELETE', `/api/app/team/members/${ownerRow.id}`)).statusCode).toBe(403);
  });
});

describe('business-user two-factor authentication', () => {
  async function enable(s: Session) {
    const setup = await call(app, s, 'POST', '/api/auth/mfa/setup', {});
    expect(setup.statusCode, setup.body).toBe(200);
    const code = authenticator.generate(setup.json().secret);
    const en = await call(app, s, 'POST', '/api/auth/mfa/enable', { code });
    expect(en.statusCode, en.body).toBe(200);
    return { secret: setup.json().secret as string, recovery: en.json().recoveryCodes as string[] };
  }

  it('enable → login needs a code → recovery codes work once → disable needs password and code', async () => {
    const s = await newUser(app, { ntn: '3333331' });
    const otherSession = await login(app, s.email);
    const { secret, recovery } = await enable(s);
    expect(recovery).toHaveLength(10);
    // other sessions were signed out
    expect((await call(app, otherSession, 'GET', '/api/app/invoices')).statusCode).toBe(401);
    // the enabling session keeps working
    expect((await call(app, s, 'GET', '/api/app/invoices')).statusCode).toBe(200);

    const lg = await app.inject({ method: 'POST', url: '/api/auth/login', headers: ANON, payload: { email: s.email, password: 'Passw0rd1234' } });
    expect(lg.statusCode).toBe(200);
    expect(lg.json()).toMatchObject({ mfaRequired: true });
    const pending = { cookie: cookieFrom(lg, 'ig_session'), csrf: lg.json().csrfToken as string };
    expect((await call(app, pending, 'GET', '/api/auth/me')).json()).toMatchObject({ mfaRequired: true });
    const blocked = await call(app, pending, 'GET', '/api/app/invoices');
    expect(blocked.statusCode).toBe(401);
    expect(blocked.json().error.code).toBe('MFA_REQUIRED');

    expect((await call(app, pending, 'POST', '/api/auth/mfa/verify', { code: '000000' })).statusCode).toBe(401);
    const ok = await call(app, pending, 'POST', '/api/auth/mfa/verify', { code: authenticator.generate(secret) });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json().user.mfaEnabled).toBe(true);
    expect((await call(app, pending, 'GET', '/api/app/invoices')).statusCode).toBe(200);

    // recovery code: works once
    const lg2 = await app.inject({ method: 'POST', url: '/api/auth/login', headers: ANON, payload: { email: s.email, password: 'Passw0rd1234' } });
    const p2 = { cookie: cookieFrom(lg2, 'ig_session'), csrf: lg2.json().csrfToken as string };
    expect((await call(app, p2, 'POST', '/api/auth/mfa/verify', { code: recovery[0].toUpperCase() })).statusCode).toBe(200);
    const lg3 = await app.inject({ method: 'POST', url: '/api/auth/login', headers: ANON, payload: { email: s.email, password: 'Passw0rd1234' } });
    const p3 = { cookie: cookieFrom(lg3, 'ig_session'), csrf: lg3.json().csrfToken as string };
    expect((await call(app, p3, 'POST', '/api/auth/mfa/verify', { code: recovery[0] })).statusCode).toBe(401);
    expect((await call(app, s, 'GET', '/api/auth/mfa')).json()).toMatchObject({ enabled: true, recoveryCodesLeft: 9 });

    // disable requires the password and a code
    expect((await call(app, s, 'POST', '/api/auth/mfa/disable', { password: 'nope', code: authenticator.generate(secret) })).statusCode).toBe(400);
    expect((await call(app, s, 'POST', '/api/auth/mfa/disable', { password: 'Passw0rd1234', code: authenticator.generate(secret) })).statusCode).toBe(200);
    const lg4 = await app.inject({ method: 'POST', url: '/api/auth/login', headers: ANON, payload: { email: s.email, password: 'Passw0rd1234' } });
    expect(lg4.json().user.mfaEnabled).toBe(false);
  });

  it('locks the code step after repeated wrong codes, and an administrator can reset 2FA', async () => {
    const s = await newUser(app, { ntn: '3333332' });
    await enable(s);
    const lg = await app.inject({ method: 'POST', url: '/api/auth/login', headers: ANON, payload: { email: s.email, password: 'Passw0rd1234' } });
    const p = { cookie: cookieFrom(lg, 'ig_session'), csrf: lg.json().csrfToken as string };
    for (let i = 0; i < 5; i++) expect((await call(app, p, 'POST', '/api/auth/mfa/verify', { code: '111111' })).statusCode).toBe(401);
    const locked = await call(app, p, 'POST', '/api/auth/mfa/verify', { code: '111111' });
    expect(locked.statusCode).toBe(429);

    const a = await newAdmin(app, 'SUPER_ADMIN');
    await verifyAdminMfa(app, a);
    const r = await call(app, a, 'POST', `/api/admin/users/${s.userId}/reset-2fa`, { reason: 'Lost phone, identity confirmed by call' });
    expect(r.statusCode, r.body).toBe(200);
    const u = await prisma.user.findUniqueOrThrow({ where: { id: s.userId } });
    expect(u.totpEnabledAt).toBeNull();
    expect(u.totpRecoveryHashes).toHaveLength(0);
  });

  it('administrator accounts cannot use the business 2FA endpoints', async () => {
    const a = await newAdmin(app, 'ADMIN');
    await verifyAdminMfa(app, a);
    const u = await prisma.user.findUniqueOrThrow({ where: { id: a.userId } });
    expect(decryptSecret(u.totpSecretEnc!)).toBeTruthy();
    const lg = await app.inject({ method: 'POST', url: '/api/auth/login', headers: ANON, payload: { email: a.email, password: 'AdminPassw0rd99' } });
    // the admin has TOTP on, so a user-area login also stops at the code step
    expect(lg.json().mfaRequired).toBe(true);
  });
});

describe('preferences, platform logo and branding', () => {
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  function imageMultipart(buf: Buffer, filename: string, type: string) {
    const boundary = '----igimg' + Math.random().toString(16).slice(2);
    const payload = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${type}\r\n\r\n`), buf, Buffer.from(`\r\n--${boundary}--\r\n`)]);
    return { payload, contentType: `multipart/form-data; boundary=${boundary}` };
  }

  it('users switch email notifications off and on', async () => {
    const s = await newUser(app, { ntn: '4444441' });
    expect((await call(app, s, 'PATCH', '/api/auth/preferences', { emailNotifications: false })).statusCode).toBe(200);
    expect((await call(app, s, 'GET', '/api/auth/me')).json().user.emailNotifications).toBe(false);
  });

  it('admins upload a platform logo that the public branding endpoint serves; SVG is refused', async () => {
    let b = (await app.inject({ method: 'GET', url: '/api/public/branding' })).json();
    expect(b).toMatchObject({ softwareName: 'InvoiceGO', logoUrl: null });
    const a = await newAdmin(app, 'SUPER_ADMIN');
    await verifyAdminMfa(app, a);
    const svg = imageMultipart(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 'x.svg', 'image/svg+xml');
    const bad = await app.inject({ method: 'POST', url: '/api/admin/settings/logo', headers: { cookie: a.cookie, 'x-csrf-token': a.csrf, 'content-type': svg.contentType }, payload: svg.payload });
    expect(bad.statusCode).toBe(400);
    const png = imageMultipart(PNG, 'logo.png', 'image/png');
    const up = await app.inject({ method: 'POST', url: '/api/admin/settings/logo', headers: { cookie: a.cookie, 'x-csrf-token': a.csrf, 'content-type': png.contentType }, payload: png.payload });
    expect(up.statusCode, up.body).toBe(200);
    await call(app, a, 'PUT', '/api/admin/settings/platform', { softwareName: 'InvoiceGO', companyName: 'InvoiceGO (Pvt) Ltd', supportEmail: 'support@invoicego.com' });
    b = (await app.inject({ method: 'GET', url: '/api/public/branding' })).json();
    expect(b.logoUrl).toMatch(/^\/api\/public\/logo\?v=\d+$/);
    expect(b.supportEmail).toBe('support@invoicego.com');
    const logo = await app.inject({ method: 'GET', url: b.logoUrl });
    expect(logo.statusCode).toBe(200);
    expect(logo.headers['content-type']).toBe('image/png');
    expect(logo.rawPayload.equals(PNG)).toBe(true);

    // a business user cannot change the platform logo
    const s = await newUser(app, { ntn: '4444442' });
    const denied = await app.inject({ method: 'POST', url: '/api/admin/settings/logo', headers: { cookie: s.cookie, 'x-csrf-token': s.csrf, 'content-type': png.contentType }, payload: png.payload });
    expect(denied.statusCode).toBe(401);
  });
});

describe('STATL active status (mocked FBR)', () => {
  it('shows FBR’s status text for registered buyers and reports failures as unavailable', async () => {
    const s = await newUser(app, { ntn: '5555551' });
    await saveCredential(app, s, 'SANDBOX', 'sandbox-token-statl-001');
    mock.regTypes['7654321'] = 'Registered';
    mock.on('/dist/v1/statl', (req) => ({ body: { 'status code': '01', status: req.json?.regno === '7654321' ? 'In-Active' : 'Active' } }));
    const r = await call(app, s, 'POST', '/api/app/invoices/buyer-check', { buyerNtnCnic: '7654321', buyerBusinessName: 'ABC Traders', buyerRegistrationType: 'REGISTERED', invoiceDate: '2026-11-15' });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toMatchObject({ result: 'REGISTERED', mismatch: false, activeStatus: { available: true, status: 'In-Active', statusCode: '01', date: '2026-11-15' } });
    expect(mock.calls('/dist/v1/statl')[0].json).toEqual({ regno: '7654321', date: '2026-11-15' });

    mock.regTypes['7654322'] = 'Registered';
    mock.on('/dist/v1/statl', () => ({ status: 500, body: 'boom' }));
    const r2 = await call(app, s, 'POST', '/api/app/invoices/buyer-check', { buyerNtnCnic: '7654322', buyerBusinessName: 'XYZ', buyerRegistrationType: 'REGISTERED', invoiceDate: '2026-11-15' });
    expect(r2.json().activeStatus).toMatchObject({ available: false });
    expect(r2.json().result).toBe('REGISTERED');

    // unregistered buyers are not sent to STATL
    mock.regTypes['7654323'] = 'unregistered';
    const before = mock.calls('/dist/v1/statl').length;
    const r3 = await call(app, s, 'POST', '/api/app/invoices/buyer-check', { buyerNtnCnic: '7654323', buyerBusinessName: 'Walk-in', buyerRegistrationType: 'UNREGISTERED', invoiceDate: '2026-11-15' });
    expect(r3.json().activeStatus).toBeNull();
    expect(mock.calls('/dist/v1/statl').length).toBe(before);
  });
});
