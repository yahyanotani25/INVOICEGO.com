import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import QRCode from 'qrcode';
import { authenticator } from 'otplib';
import { prisma } from '../../db.js';
import { decryptSecret, encryptSecret } from '../../lib/crypto.js';
import { AppError, badRequest, unauthorized } from '../../lib/errors.js';
import { hashPassword, passwordProblems } from '../../lib/password.js';
import { audit } from '../../lib/audit.js';
import { zTrim } from '../../lib/validators.js';
import { adminPermissions, checkAnonCsrf, checkCsrf, clearSessionCookie, createSession, loadSession } from '../../plugins/auth.js';
import { consumeEmailToken, passwordLogin } from '../auth/routes.js';

authenticator.options = { window: 1, step: 30 };

/** Admin session that has passed the password step but maybe not MFA yet. */
async function preMfa(req: FastifyRequest) {
  const s = await loadSession(req, 'ADMIN');
  if (!s || s.user.platformRole === 'NONE') throw unauthorized('Administrator sign-in required');
  checkCsrf(req, s);
  return s;
}

export async function adminAuthRoutes(app: FastifyInstance) {
  const strict = { config: { rateLimit: { max: 8, timeWindow: '1 minute' } } };

  app.post('/auth/login', strict, async (req, reply) => {
    checkAnonCsrf(req);
    const { email, password } = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(200) }).parse(req.body);
    const user = await passwordLogin(req, email, password, 'ADMIN');
    if (user.platformRole === 'NONE') {
      await prisma.loginEvent.create({ data: { email, kind: 'ADMIN', success: false, userId: user.id, reason: 'not an administrator', ip: req.ip } });
      throw unauthorized('Incorrect email or password');
    }
    const session = await createSession(req, reply, user, 'ADMIN', { mfaVerified: false });
    await audit(req, { action: 'admin.login.password_ok', entityType: 'User', entityId: user.id }, { userId: user.id, kind: 'ADMIN' });
    return { csrfToken: session.csrfToken, mfa: user.totpEnabledAt ? 'VERIFY' : 'ENROLL' };
  });

  app.get('/auth/me', async (req) => {
    const s = await loadSession(req, 'ADMIN');
    if (!s || s.user.platformRole === 'NONE') throw unauthorized('Administrator sign-in required');
    return {
      user: { id: s.user.id, name: s.user.name, email: s.user.email },
      role: s.user.platformRole,
      permissions: adminPermissions(s.user.platformRole),
      mfaVerified: s.mfaVerified && !!s.user.totpEnabledAt,
      needsEnrollment: !s.user.totpEnabledAt,
      csrfToken: s.csrfToken,
    };
  });

  app.post('/auth/totp/setup', strict, async (req) => {
    const s = await preMfa(req);
    if (s.user.totpEnabledAt) throw badRequest('Two-factor authentication is already enrolled');
    const secret = authenticator.generateSecret();
    await prisma.user.update({ where: { id: s.user.id }, data: { totpSecretEnc: encryptSecret(secret) } });
    const uri = authenticator.keyuri(s.user.email, 'InvoiceGO Admin', secret);
    return { otpauthUrl: uri, qrDataUrl: await QRCode.toDataURL(uri, { margin: 1, width: 220 }), secret };
  });

  app.post('/auth/totp/enable', strict, async (req) => {
    const s = await preMfa(req);
    const { code } = z.object({ code: z.string().regex(/^\d{6}$/) }).parse(req.body);
    if (s.user.totpEnabledAt || !s.user.totpSecretEnc) throw badRequest('Start enrolment first');
    if (!authenticator.verify({ token: code, secret: decryptSecret(s.user.totpSecretEnc) })) throw new AppError(401, 'MFA_INVALID', 'Invalid code');
    await prisma.user.update({ where: { id: s.user.id }, data: { totpEnabledAt: new Date() } });
    await prisma.session.update({ where: { id: s.id }, data: { mfaVerified: true } });
    await audit(req, { action: 'admin.mfa.enrolled', entityType: 'User', entityId: s.user.id }, { userId: s.user.id, kind: 'ADMIN' });
    return { ok: true };
  });

  app.post('/auth/totp/verify', strict, async (req) => {
    const s = await preMfa(req);
    const { code } = z.object({ code: z.string().regex(/^\d{6}$/) }).parse(req.body);
    if (!s.user.totpEnabledAt || !s.user.totpSecretEnc) throw badRequest('Two-factor authentication is not enrolled');
    const ok = authenticator.verify({ token: code, secret: decryptSecret(s.user.totpSecretEnc) });
    await prisma.loginEvent.create({ data: { email: s.user.email, kind: 'ADMIN', success: ok, userId: s.user.id, reason: ok ? 'mfa ok' : 'mfa failed', ip: req.ip, userAgent: req.headers['user-agent']?.slice(0, 300) } });
    if (!ok) throw new AppError(401, 'MFA_INVALID', 'Invalid code');
    await prisma.session.update({ where: { id: s.id }, data: { mfaVerified: true } });
    await audit(req, { action: 'admin.login', entityType: 'User', entityId: s.user.id }, { userId: s.user.id, kind: 'ADMIN' });
    return { ok: true };
  });

  app.post('/auth/logout', async (req, reply) => {
    const s = await loadSession(req, 'ADMIN');
    if (s) {
      checkCsrf(req, s);
      await prisma.session.update({ where: { id: s.id }, data: { revokedAt: new Date() } });
      await audit(req, { action: 'admin.logout', entityType: 'User', entityId: s.userId }, { userId: s.userId, kind: 'ADMIN' });
    }
    clearSessionCookie(reply, 'ADMIN');
    return { ok: true };
  });

  app.post('/auth/accept-invite', strict, async (req) => {
    checkAnonCsrf(req);
    const body = z.object({ token: z.string().min(10), name: zTrim(120).min(2), password: z.string().max(200) }).parse(req.body);
    const pwp = passwordProblems(body.password);
    if (pwp) throw badRequest(pwp, { issues: [{ field: 'password', level: 'error', message: pwp }] });
    if (body.password.length < 12) throw badRequest('Administrator passwords must be at least 12 characters', { issues: [{ field: 'password', level: 'error', message: 'At least 12 characters' }] });
    const row = await consumeEmailToken(body.token, 'ADMIN_INVITE');
    const user = await prisma.user.findUniqueOrThrow({ where: { id: row.userId } });
    if (user.platformRole === 'NONE') throw badRequest('This invitation is no longer valid');
    await prisma.user.update({
      where: { id: user.id },
      data: { name: body.name, passwordHash: await hashPassword(body.password), status: 'ACTIVE', emailVerifiedAt: new Date(), totpSecretEnc: null, totpEnabledAt: null },
    });
    await prisma.auditLog.create({ data: { action: 'admin.invite.accepted', actorKind: 'ADMIN', actorUserId: user.id, entityType: 'User', entityId: user.id, ip: req.ip } });
    return { ok: true, message: 'Password set. Sign in and enrol two-factor authentication.' };
  });
}
