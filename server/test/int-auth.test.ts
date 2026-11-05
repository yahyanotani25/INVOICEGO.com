/** Integration: authentication, CSRF and administrator protection (FBR not involved). */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { call, cookieFrom, getApp, login, newAdmin, newUser, prisma, registerUser, resetDb, verifyAdminMfa, verifyEmail } from './helpers';

const ANON = { 'content-type': 'application/json', 'x-requested-with': 'InvoiceGO' };
let app: FastifyInstance;

beforeAll(async () => {
  app = await getApp();
});
beforeEach(resetDb);
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe('user registration and sign-in', () => {
  it('register -> verify email -> sign in; unverified sign-in is blocked', async () => {
    const email = await registerUser(app);
    const blocked = await app.inject({ method: 'POST', url: '/api/auth/login', headers: ANON, payload: { email, password: 'Passw0rd1234' } });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error.code).toBe('EMAIL_NOT_VERIFIED');
    await verifyEmail(app, email);
    const s = await login(app, email);
    const me = await call(app, s, 'GET', '/api/auth/me');
    expect(me.json()).toMatchObject({ user: { email }, business: { role: 'OWNER' } });
    // passwords are hashed (argon2id), never stored in clear text
    const u = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(u.passwordHash).toMatch(/^\$argon2id\$/);
  });

  it('the client-designated admin email cannot be used for public registration', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      headers: ANON,
      payload: { name: 'Mallory', email: 'admininvoicego@gmail.com', phone: '03001234567', password: 'Passw0rd1234', business: { name: 'X Co', ntnCnic: '1234567', address: 'Lahore', province: 'Punjab', businessActivities: ['Other'], sector: 'FMCG' } },
    });
    expect(res.statusCode).toBe(400);
    expect(await prisma.user.count({ where: { email: 'admininvoicego@gmail.com' } })).toBe(0);
  });

  it('wrong password is rejected generically and the account locks after 5 failures', async () => {
    const s = await newUser(app);
    for (let i = 0; i < 5; i++) {
      const r = await app.inject({ method: 'POST', url: '/api/auth/login', headers: ANON, payload: { email: s.email, password: 'wrong-pass-1' } });
      expect(r.statusCode).toBe(401);
    }
    const locked = await app.inject({ method: 'POST', url: '/api/auth/login', headers: ANON, payload: { email: s.email, password: 'Passw0rd1234' } });
    expect(locked.statusCode).toBe(429);
  });

  it('state-changing requests require the CSRF header', async () => {
    const s = await newUser(app);
    const noCsrf = await app.inject({ method: 'POST', url: '/api/app/customers', headers: { cookie: s.cookie, 'content-type': 'application/json' }, payload: '{}' });
    expect(noCsrf.statusCode).toBe(403);
    expect(noCsrf.json().error.code).toBe('CSRF');
    const wrong = await app.inject({ method: 'POST', url: '/api/app/customers', headers: { cookie: s.cookie, 'x-csrf-token': 'nope', 'content-type': 'application/json' }, payload: '{}' });
    expect(wrong.statusCode).toBe(403);
    const anon = await app.inject({ method: 'POST', url: '/api/auth/login', headers: { 'content-type': 'application/json' }, payload: { email: s.email, password: 'Passw0rd1234' } });
    expect(anon.statusCode).toBe(403);
  });

  it('unauthenticated API access is refused', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/app/invoices' })).statusCode).toBe(401);
  });
});

describe('administrator protection', () => {
  it('a business user session cannot reach the admin API', async () => {
    const s = await newUser(app);
    const r = await app.inject({ method: 'GET', url: '/api/admin/dashboard', headers: { cookie: s.cookie } });
    expect(r.statusCode).toBe(401);
    const u = await app.inject({ method: 'GET', url: '/api/admin/users', headers: { cookie: s.cookie } });
    expect(u.statusCode).toBe(401);
  });

  it('a business user cannot sign in through the admin login', async () => {
    const s = await newUser(app);
    const r = await app.inject({ method: 'POST', url: '/api/admin/auth/login', headers: ANON, payload: { email: s.email, password: 'Passw0rd1234' } });
    expect(r.statusCode).toBe(401);
  });

  it('invitation-only admin: MFA_REQUIRED until TOTP is enrolled; then dashboard works without subscription data', async () => {
    const a = await newAdmin(app);
    const before = await call(app, a, 'GET', '/api/admin/dashboard');
    expect(before.statusCode).toBe(401);
    expect(before.json().error.code).toBe('MFA_REQUIRED');
    const bad = await call(app, a, 'POST', '/api/admin/auth/totp/enable', { code: '000000' });
    expect(bad.statusCode).toBe(401);
    await verifyAdminMfa(app, a);
    const dash = await call(app, a, 'GET', '/api/admin/dashboard');
    expect(dash.statusCode).toBe(200);
    const body = JSON.stringify(dash.json());
    expect(dash.json()).toHaveProperty('users.total');
    expect(body).not.toMatch(/subscription|revenue|payment/i);
    // a fresh login needs the TOTP code again
    const lg = await app.inject({ method: 'POST', url: '/api/admin/auth/login', headers: ANON, payload: { email: a.email, password: 'AdminPassw0rd99' } });
    expect(lg.json().mfa).toBe('VERIFY');
    const s2 = { cookie: cookieFrom(lg, 'ig_admin'), csrf: lg.json().csrfToken, userId: a.userId };
    expect((await call(app, s2, 'GET', '/api/admin/dashboard')).statusCode).toBe(401);
    await verifyAdminMfa(app, s2);
    expect((await call(app, s2, 'GET', '/api/admin/dashboard')).statusCode).toBe(200);
  });

  it('admin roles are enforced (SUPPORT cannot change user status) and admin actions are audited', async () => {
    const u = await newUser(app);
    const sup = await newAdmin(app, 'SUPPORT');
    await verifyAdminMfa(app, sup);
    const r = await call(app, sup, 'POST', `/api/admin/users/${u.userId}/status`, { status: 'SUSPENDED', reason: 'test' });
    expect(r.statusCode).toBe(403);
    const sa = await newAdmin(app, 'SUPER_ADMIN');
    await verifyAdminMfa(app, sa);
    const ok = await call(app, sa, 'POST', `/api/admin/users/${u.userId}/status`, { status: 'SUSPENDED', reason: 'fraud check' });
    expect(ok.statusCode).toBe(200);
    expect(await prisma.auditLog.count({ where: { action: 'admin.user.status', actorUserId: sa.userId } })).toBe(1);
    // suspended user's session is revoked
    expect((await call(app, u, 'GET', '/api/app/invoices')).statusCode).toBe(401);
  });

  it('accept-invite links are single-use and cannot be reused', async () => {
    const { createAdminInvite } = await import('../src/modules/admin/invite');
    const inv = await createAdminInvite('second-admin@invoicego.test', 'ADMIN');
    const token = new URL(inv.url).searchParams.get('token')!;
    const ok = await app.inject({ method: 'POST', url: '/api/admin/auth/accept-invite', headers: ANON, payload: { token, name: 'Second Admin', password: 'AdminPassw0rd99' } });
    expect(ok.statusCode).toBe(200);
    const again = await app.inject({ method: 'POST', url: '/api/admin/auth/accept-invite', headers: ANON, payload: { token, name: 'Attacker', password: 'AdminPassw0rd99' } });
    expect(again.statusCode).toBe(400);
  });
});
