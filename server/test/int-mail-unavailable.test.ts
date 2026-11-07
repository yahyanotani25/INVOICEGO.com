/** Integration: registration and password reset keep working when email delivery fails. */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

vi.mock('../src/lib/mailer', () => ({
  mailConfigured: () => false,
  sendMail: async () => {
    throw new Error('SMTP is not configured; cannot send email in production');
  },
}));

const { getApp, newAdmin, prisma, resetDb, verifyAdminMfa, call } = await import('./helpers');

const ANON = { 'content-type': 'application/json', 'x-requested-with': 'InvoiceGO' };
let app: FastifyInstance;

beforeAll(async () => {
  app = await getApp();
});
beforeEach(async () => {
  await resetDb();
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

const registration = {
  name: 'Hotel Owner',
  email: 'hotel@invoicego.test',
  phone: '03001234567',
  password: 'Passw0rd1234',
  business: { name: 'Hotel Traders', ntnCnic: '8888888', address: 'Mall Road, Lahore', province: 'Punjab', businessActivities: ['Retailer'], sector: 'FMCG' },
};

describe('email unavailable', () => {
  it('registration succeeds, admins are told to activate, and admin activation counts as verification', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/auth/register', headers: ANON, payload: registration });
    expect(r.statusCode, r.body).toBe(201);
    expect(r.json().emailSent).toBe(false);
    const u = await prisma.user.findUniqueOrThrow({ where: { email: 'hotel@invoicego.test' } });
    expect(u.status).toBe('PENDING_VERIFICATION');
    const n = await prisma.notification.findFirstOrThrow({ where: { audience: 'ADMINS', type: 'NEW_REGISTRATION' } });
    expect(n.title).toMatch(/NOT sent/);

    const blocked = await app.inject({ method: 'POST', url: '/api/auth/login', headers: ANON, payload: { email: 'hotel@invoicego.test', password: 'Passw0rd1234' } });
    expect(blocked.json().error.code).toBe('EMAIL_NOT_VERIFIED');

    const a = await newAdmin(app, 'SUPER_ADMIN');
    await verifyAdminMfa(app, a);
    const act = await call(app, a, 'POST', `/api/admin/users/${u.id}/status`, { status: 'ACTIVE', reason: 'Verified by phone' });
    expect(act.statusCode).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).emailVerifiedAt).not.toBeNull();
    const ok = await app.inject({ method: 'POST', url: '/api/auth/login', headers: ANON, payload: { email: 'hotel@invoicego.test', password: 'Passw0rd1234' } });
    expect(ok.statusCode).toBe(200);
  });

  it('forgot-password returns the same generic answer even if email fails', async () => {
    await app.inject({ method: 'POST', url: '/api/auth/register', headers: ANON, payload: registration });
    const r = await app.inject({ method: 'POST', url: '/api/auth/forgot-password', headers: ANON, payload: { email: 'hotel@invoicego.test' } });
    expect(r.statusCode).toBe(200);
    expect(r.json().ok).toBe(true);
  });
});
