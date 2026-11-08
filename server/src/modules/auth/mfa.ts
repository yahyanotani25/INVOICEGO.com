import type { FastifyInstance, FastifyRequest } from 'fastify';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import QRCode from 'qrcode';
import { authenticator } from 'otplib';
import { prisma } from '../../db.js';
import { decryptSecret, encryptSecret, sha256Hex } from '../../lib/crypto.js';
import { AppError, badRequest, forbidden, unauthorized } from '../../lib/errors.js';
import { verifyPassword } from '../../lib/password.js';
import { audit } from '../../lib/audit.js';
import { checkCsrf, loadSession, requireUser } from '../../plugins/auth.js';
import { notifyUser } from '../notifications/notify.js';
import { meDto } from './routes.js';

/**
 * Optional two-factor authentication (TOTP) for business users. When enabled, a password login
 * creates a session that cannot access the app until a 6-digit code (or a single-use recovery
 * code) is verified. Administrators use their own, mandatory TOTP in the admin console.
 */

authenticator.options = { window: 1, step: 30 };

const RECOVERY_COUNT = 10;
const RECOVERY_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'; // no 0/o, 1/l/i
const MAX_FAILED_CODES = 5;
const FAILED_WINDOW_MIN = 15;

function newRecoveryCodes(): string[] {
  return Array.from({ length: RECOVERY_COUNT }, () => {
    const bytes = randomBytes(10);
    const chars = Array.from(bytes, (b) => RECOVERY_ALPHABET[b % RECOVERY_ALPHABET.length]).join('');
    return `${chars.slice(0, 5)}-${chars.slice(5)}`;
  });
}

const normaliseRecovery = (code: string) => code.trim().toLowerCase().replace(/[\s-]/g, '');
const hashRecovery = (code: string) => sha256Hex(`invoicego-recovery:${normaliseRecovery(code)}`);

const codeSchema = z.object({ code: z.string().trim().min(6).max(20) });

/** Checks a TOTP code or a recovery code. A used recovery code is removed. */
async function checkSecondFactor(user: { id: string; totpSecretEnc: string | null; totpRecoveryHashes: string[] }, code: string): Promise<'totp' | 'recovery' | null> {
  const digits = code.replace(/\s/g, '');
  if (/^\d{6}$/.test(digits)) {
    if (user.totpSecretEnc && authenticator.verify({ token: digits, secret: decryptSecret(user.totpSecretEnc) })) return 'totp';
    return null;
  }
  const h = hashRecovery(code);
  if (!user.totpRecoveryHashes.includes(h)) return null;
  // Remove atomically so the same recovery code cannot be used twice concurrently.
  const updated = await prisma.$executeRaw`UPDATE "User" SET "totpRecoveryHashes" = array_remove("totpRecoveryHashes", ${h}) WHERE id = ${user.id} AND ${h} = ANY("totpRecoveryHashes")`;
  return updated === 1 ? 'recovery' : null;
}

async function recentFailures(userId: string) {
  return prisma.loginEvent.count({ where: { userId, kind: 'USER', success: false, reason: 'mfa failed', createdAt: { gte: new Date(Date.now() - FAILED_WINDOW_MIN * 60_000) } } });
}

function businessUserOnly(user: { platformRole: string }) {
  if (user.platformRole !== 'NONE') throw forbidden('Administrator two-factor authentication is managed in the admin console.');
}

export async function userMfaRoutes(app: FastifyInstance) {
  const strict = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };

  /** Second login step. Works on a session that has passed the password step only. */
  app.post('/auth/mfa/verify', strict, async (req: FastifyRequest) => {
    const s = await loadSession(req, 'USER');
    if (!s) throw unauthorized('Your sign-in has expired. Sign in again.');
    checkCsrf(req, s);
    if (!s.user.totpEnabledAt) throw badRequest('Two-factor authentication is not enabled for this account.');
    if (s.mfaVerified) return meDto(s.userId, s.id, s.csrfToken, s.activeBusinessId);
    if ((await recentFailures(s.userId)) >= MAX_FAILED_CODES) {
      await prisma.session.update({ where: { id: s.id }, data: { revokedAt: new Date() } });
      throw new AppError(429, 'MFA_LOCKED', `Too many incorrect codes. Sign in again after ${FAILED_WINDOW_MIN} minutes.`);
    }
    const { code } = codeSchema.parse(req.body);
    const kind = await checkSecondFactor(s.user, code);
    await prisma.loginEvent.create({ data: { email: s.user.email, kind: 'USER', success: !!kind, userId: s.userId, reason: kind ? `mfa ok (${kind})` : 'mfa failed', ip: req.ip, userAgent: req.headers['user-agent']?.slice(0, 300) } });
    if (!kind) throw new AppError(401, 'MFA_INVALID', 'That code is not correct. Enter the current 6-digit code from your authenticator app, or a recovery code.');
    await prisma.session.update({ where: { id: s.id }, data: { mfaVerified: true } });
    await audit(req, { action: kind === 'recovery' ? 'user.mfa.recovery_code_used' : 'user.mfa.verified', entityType: 'User', entityId: s.userId }, { userId: s.userId, kind: 'USER' });
    if (kind === 'recovery') {
      const left = (await prisma.user.findUniqueOrThrow({ where: { id: s.userId }, select: { totpRecoveryHashes: true } })).totpRecoveryHashes.length;
      await notifyUser(s.userId, 'SECURITY', 'A recovery code was used to sign in', `A two-factor recovery code was used to sign in to your account. ${left} recovery code(s) remain. If this was not you, change your password now.`, '/app/settings', { log: req.log });
    }
    return meDto(s.userId, s.id, s.csrfToken, s.activeBusinessId);
  });

  app.get('/auth/mfa', { preHandler: requireUser }, async (req) => {
    const u = req.auth!.user;
    return { enabled: !!u.totpEnabledAt, enabledAt: u.totpEnabledAt, recoveryCodesLeft: u.totpEnabledAt ? u.totpRecoveryHashes.length : 0 };
  });

  app.post('/auth/mfa/setup', { ...strict, preHandler: requireUser }, async (req) => {
    const u = req.auth!.user;
    businessUserOnly(u);
    if (u.totpEnabledAt) throw badRequest('Two-factor authentication is already on. Turn it off first to set up a new device.');
    const secret = authenticator.generateSecret();
    await prisma.user.update({ where: { id: u.id }, data: { totpSecretEnc: encryptSecret(secret) } });
    const uri = authenticator.keyuri(u.email, 'InvoiceGO', secret);
    return { otpauthUrl: uri, qrDataUrl: await QRCode.toDataURL(uri, { margin: 1, width: 220 }), secret };
  });

  app.post('/auth/mfa/enable', { ...strict, preHandler: requireUser }, async (req) => {
    const u = req.auth!.user;
    businessUserOnly(u);
    const { code } = z.object({ code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code') }).parse(req.body);
    if (u.totpEnabledAt) throw badRequest('Two-factor authentication is already on.');
    if (!u.totpSecretEnc) throw badRequest('Start the setup first.');
    if (!authenticator.verify({ token: code, secret: decryptSecret(u.totpSecretEnc) })) throw new AppError(401, 'MFA_INVALID', 'That code is not correct. Check the time on your phone and try the current code.');
    const codes = newRecoveryCodes();
    await prisma.user.update({ where: { id: u.id }, data: { totpEnabledAt: new Date(), totpRecoveryHashes: codes.map(hashRecovery) } });
    await prisma.session.update({ where: { id: req.auth!.session.id }, data: { mfaVerified: true } });
    // Other sessions were signed in without the second factor; sign them out.
    await prisma.session.updateMany({ where: { userId: u.id, kind: 'USER', revokedAt: null, NOT: { id: req.auth!.session.id } }, data: { revokedAt: new Date() } });
    await audit(req, { action: 'user.mfa.enabled', entityType: 'User', entityId: u.id });
    await notifyUser(u.id, 'SECURITY', 'Two-factor authentication turned on', 'Two-factor authentication is now required when you sign in to InvoiceGO. Keep your recovery codes somewhere safe.', '/app/settings', { log: req.log });
    return { ok: true, recoveryCodes: codes };
  });

  app.post('/auth/mfa/recovery-codes', { ...strict, preHandler: requireUser }, async (req) => {
    const u = req.auth!.user;
    businessUserOnly(u);
    if (!u.totpEnabledAt || !u.totpSecretEnc) throw badRequest('Two-factor authentication is not on.');
    const { code } = z.object({ code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code') }).parse(req.body);
    if (!authenticator.verify({ token: code, secret: decryptSecret(u.totpSecretEnc) })) throw new AppError(401, 'MFA_INVALID', 'That code is not correct.');
    const codes = newRecoveryCodes();
    await prisma.user.update({ where: { id: u.id }, data: { totpRecoveryHashes: codes.map(hashRecovery) } });
    await audit(req, { action: 'user.mfa.recovery_codes_regenerated', entityType: 'User', entityId: u.id });
    return { ok: true, recoveryCodes: codes };
  });

  app.post('/auth/mfa/disable', { ...strict, preHandler: requireUser }, async (req) => {
    const u = req.auth!.user;
    businessUserOnly(u);
    const { password, code } = z.object({ password: z.string().min(1).max(200), code: z.string().trim().min(6).max(20) }).parse(req.body);
    if (!u.totpEnabledAt) throw badRequest('Two-factor authentication is not on.');
    if (!(await verifyPassword(u.passwordHash, password))) throw badRequest('Password is incorrect', { issues: [{ field: 'password', level: 'error', message: 'Password is incorrect' }] });
    if (!(await checkSecondFactor(u, code))) throw new AppError(401, 'MFA_INVALID', 'That code is not correct.');
    await prisma.user.update({ where: { id: u.id }, data: { totpEnabledAt: null, totpSecretEnc: null, totpRecoveryHashes: [] } });
    await audit(req, { action: 'user.mfa.disabled', entityType: 'User', entityId: u.id });
    await notifyUser(u.id, 'SECURITY', 'Two-factor authentication turned off', 'Two-factor authentication was turned off for your InvoiceGO account. If this was not you, change your password and contact support.', '/app/settings', { log: req.log });
    return { ok: true };
  });

  app.patch('/auth/preferences', { preHandler: requireUser }, async (req) => {
    const body = z.object({ emailNotifications: z.boolean() }).parse(req.body);
    await prisma.user.update({ where: { id: req.auth!.user.id }, data: { emailNotifications: body.emailNotifications } });
    await audit(req, { action: 'user.preferences', entityType: 'User', entityId: req.auth!.user.id, metadata: body });
    return { ok: true, ...body };
  });
}

/** Administrator action: clears a business user's two-factor settings (lost device). */
export async function resetUserMfa(userId: string) {
  await prisma.user.update({ where: { id: userId }, data: { totpEnabledAt: null, totpSecretEnc: null, totpRecoveryHashes: [] } });
  await prisma.session.updateMany({ where: { userId, kind: 'USER', revokedAt: null }, data: { revokedAt: new Date() } });
}
