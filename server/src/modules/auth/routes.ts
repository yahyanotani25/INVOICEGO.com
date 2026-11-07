import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../db.js';
import { config } from '../../config.js';
import { randomToken, sha256Hex } from '../../lib/crypto.js';
import { AppError, badRequest, unauthorized } from '../../lib/errors.js';
import { hashPassword, passwordProblems, verifyPassword } from '../../lib/password.js';
import { sendMail } from '../../lib/mailer.js';
import { audit } from '../../lib/audit.js';
import { BUSINESS_ACTIVITIES, SECTORS, ntnCnicProblem, zTrim } from '../../lib/validators.js';
import { checkAnonCsrf, clearSessionCookie, createSession, loadSession, requireUser } from '../../plugins/auth.js';
import { notifyAdmins } from '../notifications/notify.js';

/** Emails reserved for the platform administrator; public registration can never use them. */
const RESERVED_ADMIN_EMAILS = ['admininvoicego@gmail.com'];

const registerSchema = z.object({
  name: zTrim(120).min(2),
  email: z.string().trim().toLowerCase().email().max(200),
  phone: zTrim(30).min(7),
  password: z.string().min(1).max(200),
  business: z.object({
    name: zTrim(200).min(2),
    ntnCnic: zTrim(20),
    strn: zTrim(30).optional().nullable(),
    address: zTrim(300).min(3),
    province: zTrim(100).min(2),
    businessActivities: z.array(z.enum(BUSINESS_ACTIVITIES)).min(1, 'Select at least one business nature'),
    sector: z.enum(SECTORS),
    retailerRegistered: z.boolean().optional().default(false),
  }),
});

const LOCK_AFTER = 5;
let dummyHash: Promise<string> | null = null; // equalises timing for unknown emails
const LOCK_MINUTES = 15;

export async function issueEmailToken(userId: string, purpose: 'VERIFY_EMAIL' | 'RESET_PASSWORD' | 'ADMIN_INVITE', hours: number, createdById?: string) {
  const token = randomToken(32);
  await prisma.emailToken.updateMany({ where: { userId, purpose, usedAt: null }, data: { usedAt: new Date() } });
  await prisma.emailToken.create({ data: { userId, purpose, tokenHash: sha256Hex(token), expiresAt: new Date(Date.now() + hours * 3600_000), createdById } });
  return token;
}

export async function consumeEmailToken(token: string, purpose: 'VERIFY_EMAIL' | 'RESET_PASSWORD' | 'ADMIN_INVITE') {
  const row = await prisma.emailToken.findUnique({ where: { tokenHash: sha256Hex(token) } });
  if (!row || row.purpose !== purpose || row.usedAt || row.expiresAt < new Date()) {
    throw badRequest('This link is invalid or has expired. Request a new one.', undefined, 'TOKEN_INVALID');
  }
  await prisma.emailToken.update({ where: { id: row.id }, data: { usedAt: new Date() } });
  return row;
}

export async function sendPasswordReset(req: FastifyRequest, userId: string, email: string, createdById?: string) {
  const token = await issueEmailToken(userId, 'RESET_PASSWORD', 1, createdById);
  await sendMail(email, 'Reset your InvoiceGO password', `Reset your password (valid for 1 hour):\n${config.APP_BASE_URL}/reset-password?token=${token}\n\nIf you did not request this, ignore this email.`, req.log);
}

async function sendVerification(req: FastifyRequest, userId: string, email: string) {
  const token = await issueEmailToken(userId, 'VERIFY_EMAIL', 48);
  await sendMail(email, 'Verify your InvoiceGO email', `Welcome to InvoiceGO.\n\nVerify your email address:\n${config.APP_BASE_URL}/verify-email?token=${token}\n`, req.log);
}

async function logLogin(req: FastifyRequest, email: string, kind: 'USER' | 'ADMIN', success: boolean, userId?: string, reason?: string) {
  await prisma.loginEvent.create({ data: { email, kind, success, userId, reason, ip: req.ip, userAgent: req.headers['user-agent']?.slice(0, 300) } });
}

/** Shared password check with lockout. Returns the user or throws a generic error. */
export async function passwordLogin(req: FastifyRequest, email: string, password: string, kind: 'USER' | 'ADMIN') {
  const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  const generic = unauthorized('Incorrect email or password');
  if (!user || user.deletedAt) {
    dummyHash ??= hashPassword(randomToken(16));
    await verifyPassword(await dummyHash, password);
    await logLogin(req, email, kind, false, undefined, 'unknown user');
    throw generic;
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    await logLogin(req, email, kind, false, user.id, 'locked');
    throw new AppError(429, 'LOCKED', `Too many failed attempts. Try again after ${LOCK_MINUTES} minutes.`);
  }
  const ok = await verifyPassword(user.passwordHash, password);
  if (!ok) {
    const failed = user.failedLogins + 1;
    await prisma.user.update({
      where: { id: user.id },
      data: { failedLogins: failed >= LOCK_AFTER ? 0 : failed, lockedUntil: failed >= LOCK_AFTER ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null },
    });
    await logLogin(req, email, kind, false, user.id, 'bad password');
    throw generic;
  }
  if (user.status === 'PENDING_VERIFICATION') {
    await logLogin(req, email, kind, false, user.id, 'unverified');
    throw new AppError(403, 'EMAIL_NOT_VERIFIED', 'Please verify your email address first. Check your inbox or request a new link.');
  }
  if (user.status !== 'ACTIVE') {
    await logLogin(req, email, kind, false, user.id, `status ${user.status}`);
    throw new AppError(403, 'ACCOUNT_' + user.status, `This account is ${user.status.toLowerCase()}. Contact support.`);
  }
  await prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } });
  await logLogin(req, email, kind, true, user.id);
  return user;
}

export async function meDto(userId: string, sessionId: string, csrfToken: string, activeBusinessId: string | null) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const memberships = await prisma.membership.findMany({ where: { userId }, include: { business: true }, orderBy: { createdAt: 'asc' } });
  const active = memberships.find((m) => m.businessId === activeBusinessId) ?? memberships[0];
  return {
    user: { id: user.id, name: user.name, email: user.email, phone: user.phone, emailVerified: !!user.emailVerifiedAt },
    csrfToken,
    sessionId,
    businesses: memberships.map((m) => ({ id: m.businessId, name: m.business.name, role: m.role })),
    business: active
      ? {
          id: active.businessId,
          name: active.business.name,
          role: active.role,
          productionEnabled: active.business.productionEnabled,
          ntnCnic: active.business.ntnCnic,
        }
      : null,
  };
}

export async function authRoutes(app: FastifyInstance) {
  const strict = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };

  app.post('/auth/register', strict, async (req, reply) => {
    checkAnonCsrf(req);
    const body = registerSchema.parse(req.body);
    const pwp = passwordProblems(body.password);
    if (pwp) throw badRequest(pwp, { issues: [{ field: 'password', level: 'error', message: pwp }] });
    const np = ntnCnicProblem(body.business.ntnCnic, true);
    if (np) throw badRequest(np, { issues: [{ field: 'business.ntnCnic', level: 'error', message: np }] });
    if (RESERVED_ADMIN_EMAILS.includes(body.email)) {
      throw badRequest('This email address cannot be used for a business account.', { issues: [{ field: 'email', level: 'error', message: 'This email address cannot be used for a business account.' }] });
    }
    const existing = await prisma.user.findUnique({ where: { email: body.email } });
    if (existing) {
      // Do not reveal whether the email exists beyond what is needed; tell the user to sign in.
      throw new AppError(409, 'EMAIL_TAKEN', 'An account with this email already exists. Sign in or reset your password.');
    }
    const passwordHash = await hashPassword(body.password);
    const { user, business } = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({ data: { name: body.name, email: body.email, phone: body.phone, passwordHash, status: 'PENDING_VERIFICATION' } });
      const business = await tx.business.create({
        data: {
          name: body.business.name,
          ntnCnic: body.business.ntnCnic.trim(),
          strn: body.business.strn || null,
          address: body.business.address,
          province: body.business.province,
          phone: body.phone,
          email: body.email,
          businessActivities: body.business.businessActivities,
          sector: body.business.sector,
          retailerRegistered: body.business.retailerRegistered,
        },
      });
      await tx.membership.create({ data: { userId: user.id, businessId: business.id, role: 'OWNER' } });
      return { user, business };
    });
    let emailSent = true;
    try {
      await sendVerification(req, user.id, user.email);
    } catch (e) {
      // The account exists; never fail the registration because email delivery is unavailable.
      emailSent = false;
      req.log.error({ err: (e as Error).message }, 'verification email could not be sent');
    }
    await audit(req, { action: 'user.register', entityType: 'User', entityId: user.id, businessId: business.id, metadata: { verificationEmailSent: emailSent } }, { userId: user.id, kind: 'USER' });
    await notifyAdmins(
      'NEW_REGISTRATION',
      emailSent ? 'New registration' : 'New registration — verification email NOT sent',
      emailSent ? `${user.name} registered ${business.name}` : `${user.name} registered ${business.name}. Email could not be sent; review and activate the account manually.`,
      `/admin/users/${user.id}`,
      business.id,
    );
    return reply.status(201).send({
      ok: true,
      emailSent,
      message: emailSent
        ? 'Account created. Check your email to verify your address before signing in.'
        : 'Account created, but the verification email could not be sent right now. An administrator will review and activate your account, or contact support.',
    });
  });

  app.post('/auth/verify-email', strict, async (req) => {
    checkAnonCsrf(req);
    const { token } = z.object({ token: z.string().min(10) }).parse(req.body);
    const row = await consumeEmailToken(token, 'VERIFY_EMAIL');
    const user = await prisma.user.findUniqueOrThrow({ where: { id: row.userId } });
    await prisma.user.update({
      where: { id: user.id },
      data: { emailVerifiedAt: new Date(), status: user.status === 'PENDING_VERIFICATION' ? 'ACTIVE' : user.status },
    });
    await audit(req, { action: 'user.verify_email', entityType: 'User', entityId: user.id }, { userId: user.id, kind: 'USER' });
    return { ok: true };
  });

  app.post('/auth/resend-verification', strict, async (req) => {
    checkAnonCsrf(req);
    const { email } = z.object({ email: z.string().trim().toLowerCase().email() }).parse(req.body);
    const user = await prisma.user.findUnique({ where: { email } });
    if (user && user.status === 'PENDING_VERIFICATION') await sendVerification(req, user.id, user.email).catch((e) => req.log.error({ err: (e as Error).message }, 'verification email could not be sent'));
    return { ok: true, message: 'If the account exists and is not verified, a new link has been sent.' };
  });

  app.post('/auth/login', strict, async (req, reply) => {
    checkAnonCsrf(req);
    const { email, password } = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(200) }).parse(req.body);
    const user = await passwordLogin(req, email, password, 'USER');
    const first = await prisma.membership.findFirst({ where: { userId: user.id }, orderBy: { createdAt: 'asc' } });
    const session = await createSession(req, reply, user, 'USER', { activeBusinessId: first?.businessId ?? null });
    await audit(req, { action: 'user.login', entityType: 'User', entityId: user.id }, { userId: user.id, kind: 'USER' });
    return meDto(user.id, session.id, session.csrfToken, session.activeBusinessId);
  });

  app.get('/auth/me', async (req) => {
    const s = await loadSession(req, 'USER');
    if (!s) throw unauthorized();
    return meDto(s.userId, s.id, s.csrfToken, s.activeBusinessId);
  });

  app.post('/auth/logout', async (req, reply) => {
    const s = await loadSession(req, 'USER');
    if (s) {
      if (req.headers['x-csrf-token'] !== s.csrfToken) throw new AppError(403, 'CSRF', 'Invalid CSRF token');
      await prisma.session.update({ where: { id: s.id }, data: { revokedAt: new Date() } });
    }
    clearSessionCookie(reply, 'USER');
    return { ok: true };
  });

  app.post('/auth/forgot-password', strict, async (req) => {
    checkAnonCsrf(req);
    const { email } = z.object({ email: z.string().trim().toLowerCase().email() }).parse(req.body);
    const user = await prisma.user.findUnique({ where: { email } });
    if (user && !user.deletedAt && ['ACTIVE', 'PENDING_VERIFICATION'].includes(user.status) && user.platformRole === 'NONE') {
      await sendPasswordReset(req, user.id, user.email).catch((e) => req.log.error({ err: (e as Error).message }, 'password reset email could not be sent'));
    }
    return { ok: true, message: 'If an account exists for this email, a reset link has been sent.' };
  });

  app.post('/auth/reset-password', strict, async (req) => {
    checkAnonCsrf(req);
    const { token, password } = z.object({ token: z.string().min(10), password: z.string().max(200) }).parse(req.body);
    const pwp = passwordProblems(password);
    if (pwp) throw badRequest(pwp, { issues: [{ field: 'password', level: 'error', message: pwp }] });
    const row = await consumeEmailToken(token, 'RESET_PASSWORD');
    await prisma.user.update({ where: { id: row.userId }, data: { passwordHash: await hashPassword(password), failedLogins: 0, lockedUntil: null } });
    await prisma.session.updateMany({ where: { userId: row.userId, revokedAt: null }, data: { revokedAt: new Date() } });
    await audit(req, { action: 'user.reset_password', entityType: 'User', entityId: row.userId }, { userId: row.userId, kind: 'USER' });
    return { ok: true };
  });

  // ---- authenticated account endpoints
  app.post('/auth/change-password', { preHandler: requireUser }, async (req) => {
    const { currentPassword, newPassword } = z.object({ currentPassword: z.string(), newPassword: z.string().max(200) }).parse(req.body);
    const user = req.auth!.user;
    if (!(await verifyPassword(user.passwordHash, currentPassword))) throw badRequest('Current password is incorrect', { issues: [{ field: 'currentPassword', level: 'error', message: 'Current password is incorrect' }] });
    const pwp = passwordProblems(newPassword);
    if (pwp) throw badRequest(pwp, { issues: [{ field: 'newPassword', level: 'error', message: pwp }] });
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(newPassword) } });
    await prisma.session.updateMany({ where: { userId: user.id, revokedAt: null, NOT: { id: req.auth!.session.id } }, data: { revokedAt: new Date() } });
    await audit(req, { action: 'user.change_password', entityType: 'User', entityId: user.id });
    return { ok: true };
  });

  app.patch('/auth/profile', { preHandler: requireUser }, async (req) => {
    const body = z.object({ name: zTrim(120).min(2), phone: zTrim(30).min(7) }).parse(req.body);
    await prisma.user.update({ where: { id: req.auth!.user.id }, data: body });
    await audit(req, { action: 'user.update_profile', entityType: 'User', entityId: req.auth!.user.id });
    return { ok: true };
  });

  app.get('/auth/sessions', { preHandler: requireUser }, async (req) => {
    const rows = await prisma.session.findMany({ where: { userId: req.auth!.user.id, kind: 'USER', revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { lastSeenAt: 'desc' } });
    return rows.map((s) => ({ id: s.id, ip: s.ip, userAgent: s.userAgent, createdAt: s.createdAt, lastSeenAt: s.lastSeenAt, current: s.id === req.auth!.session.id }));
  });

  app.delete('/auth/sessions/:id', { preHandler: requireUser }, async (req) => {
    const { id } = req.params as { id: string };
    await prisma.session.updateMany({ where: { id, userId: req.auth!.user.id }, data: { revokedAt: new Date() } });
    await audit(req, { action: 'user.revoke_session', entityType: 'Session', entityId: id });
    return { ok: true };
  });

  app.get('/auth/login-history', { preHandler: requireUser }, async (req) => {
    return prisma.loginEvent.findMany({ where: { userId: req.auth!.user.id, kind: 'USER' }, orderBy: { createdAt: 'desc' }, take: 50 });
  });

  app.post('/auth/switch-business', { preHandler: requireUser }, async (req) => {
    const { businessId } = z.object({ businessId: z.string() }).parse(req.body);
    const m = await prisma.membership.findUnique({ where: { userId_businessId: { userId: req.auth!.user.id, businessId } } });
    if (!m) throw new AppError(404, 'NOT_FOUND', 'Business not found');
    await prisma.session.update({ where: { id: req.auth!.session.id }, data: { activeBusinessId: businessId } });
    return meDto(req.auth!.user.id, req.auth!.session.id, req.auth!.session.csrfToken, businessId);
  });
}
