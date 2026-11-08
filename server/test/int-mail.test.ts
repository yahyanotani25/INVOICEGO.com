/** Integration: notification emails are sent when SMTP is configured and respect each user's setting. FBR is MOCKED. */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

const sent: { to: string; subject: string; text: string }[] = [];
vi.mock('../src/lib/mailer', () => ({
  mailConfigured: () => true,
  sendMail: async (to: string, subject: string, text: string) => {
    sent.push({ to, subject, text });
  },
}));

const { MockFbr, PATHS, headerInvalid } = await import('./mockFbr');
const { call, createInvoice, fixClock, getApp, newAdmin, newUser, prisma, realClock, resetDb, saveCredential, verifyAdminMfa } = await import('./helpers');

const mock = new MockFbr();
let app: FastifyInstance;
const to = (email: string) => sent.filter((m) => m.to === email);

beforeAll(async () => {
  await mock.start();
  app = await getApp();
});
beforeEach(async () => {
  fixClock();
  await resetDb();
  mock.reset();
  sent.length = 0;
});
afterAll(async () => {
  realClock();
  await mock.stop();
  await app.close();
  await prisma.$disconnect();
});

describe('notification emails', () => {
  it('a rejected FBR submission emails the business members who have email notifications on', async () => {
    const owner = await newUser(app, { ntn: '6100001', businessName: 'Mail Co' });
    await saveCredential(app, owner, 'SANDBOX', 'sandbox-token-mail-01');
    const inv = await createInvoice(app, owner);
    await call(app, owner, 'POST', `/api/app/invoices/${inv.id}/validate`, {});
    mock.on(PATHS.postSb, headerInvalid);
    sent.length = 0;
    const r = await call(app, owner, 'POST', `/api/app/invoices/${inv.id}/submit`, {});
    expect(r.statusCode, r.body).toBeLessThan(500);
    const mails = to(owner.email);
    expect(mails).toHaveLength(1);
    expect(mails[0].subject).toMatch(/\[InvoiceGO\] Invoice .* was not accepted/);
    expect(mails[0].text).toContain(`/app/invoices/${inv.id}`);
    expect(mails[0].text).toContain('turn them off');

    // switched off: the in-app notification is still created, no email
    await call(app, owner, 'PATCH', '/api/auth/preferences', { emailNotifications: false });
    const inv2 = await createInvoice(app, owner);
    await call(app, owner, 'POST', `/api/app/invoices/${inv2.id}/validate`, {});
    sent.length = 0;
    await call(app, owner, 'POST', `/api/app/invoices/${inv2.id}/submit`, {});
    expect(to(owner.email)).toHaveLength(0);
    expect(await prisma.notification.count({ where: { userId: owner.userId, type: 'FBR_SUBMISSION_FAILED' } })).toBe(2);
  });

  it('support replies email the user; new tickets email support staff; registrations email admins', async () => {
    const admin = await newAdmin(app, 'SUPER_ADMIN', 'boss@invoicego.test');
    await verifyAdminMfa(app, admin);
    sent.length = 0;
    const user = await newUser(app, { email: 'shop@invoicego.test', ntn: '6100002' });
    expect(to('boss@invoicego.test').some((m) => /New registration/.test(m.subject))).toBe(true);
    expect(to('shop@invoicego.test').some((m) => /Verify your InvoiceGO email/.test(m.subject))).toBe(true);

    sent.length = 0;
    const t = await call(app, user, 'POST', '/api/app/support/tickets', { title: 'Cannot submit', description: 'FBR says 0401', category: 'TECHNICAL', priority: 'HIGH', queryType: 'POST_INTEGRATION' });
    expect(t.statusCode, t.body).toBe(201);
    expect(to('boss@invoicego.test').some((m) => /New high ticket/.test(m.subject))).toBe(true);

    sent.length = 0;
    const rep = await call(app, admin, 'POST', `/api/admin/support/${t.json().id}/reply`, { body: 'Please re-check your token.' });
    expect(rep.statusCode, rep.body).toBe(200);
    expect(to('shop@invoicego.test')[0].subject).toMatch(/Support replied to ticket/);
  });

  it('announcements can be emailed to every active business user', async () => {
    const admin = await newAdmin(app, 'SUPER_ADMIN');
    await verifyAdminMfa(app, admin);
    const a = await newUser(app, { email: 'a@invoicego.test', ntn: '6100003' });
    await newUser(app, { email: 'b@invoicego.test', ntn: '6100004' });
    await call(app, a, 'PATCH', '/api/auth/preferences', { emailNotifications: false });
    sent.length = 0;
    const r = await call(app, admin, 'POST', '/api/admin/announcements', { kind: 'MAINTENANCE', title: 'Maintenance on Sunday', body: 'FBR submissions pause 02:00–03:00 PKT.', notifyUsers: true, emailUsers: true });
    expect(r.statusCode, r.body).toBe(200);
    expect(to('b@invoicego.test')).toHaveLength(1);
    expect(to('a@invoicego.test')).toHaveLength(0);
    const job = await prisma.job.findUniqueOrThrow({ where: { id: r.json().emailJobId } });
    expect(job.status).toBe('SUCCEEDED');
  });

  it('team invitations are emailed with a working link', async () => {
    const owner = await newUser(app, { ntn: '6100005', businessName: 'Invite Co' });
    sent.length = 0;
    const r = await call(app, owner, 'POST', '/api/app/team/invites', { email: 'new.person@invoicego.test', role: 'ACCOUNTANT' });
    expect(r.statusCode, r.body).toBe(201);
    expect(r.json()).toMatchObject({ emailed: true });
    expect(r.json().url).toBeUndefined();
    const m = to('new.person@invoicego.test')[0];
    expect(m.subject).toBe("You're invited to join Invite Co on InvoiceGO");
    const link = /https?:\/\/\S+\/accept-invite\?token=(\S+)/.exec(m.text);
    expect(link).not.toBeNull();
    const view = await app.inject({ method: 'GET', url: `/api/auth/team-invite?token=${link![1]}` });
    expect(view.statusCode).toBe(200);
  });
});
