import type { FastifyReply, FastifyRequest } from 'fastify';
import type { MemberRole, PlatformRole, Session, User } from '@prisma/client';
import { prisma } from '../db.js';
import { config } from '../config.js';
import { randomToken, safeEqual, sha256Hex } from '../lib/crypto.js';
import { AppError, forbidden, unauthorized } from '../lib/errors.js';

export interface AuthContext {
  kind: 'USER' | 'ADMIN';
  session: Session;
  user: User;
  businessId: string | null;
  role: MemberRole | null;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthContext;
  }
}

export const USER_COOKIE = 'ig_session';
export const ADMIN_COOKIE = 'ig_admin';
const IDLE_MINUTES = { USER: 120, ADMIN: 30 } as const;

function cookieOpts(kind: 'USER' | 'ADMIN', maxAgeSec: number) {
  return {
    path: kind === 'ADMIN' ? '/api/admin' : '/api',
    httpOnly: true,
    secure: config.COOKIE_SECURE,
    sameSite: 'lax' as const,
    maxAge: maxAgeSec,
  };
}

export async function createSession(
  req: FastifyRequest,
  reply: FastifyReply,
  user: User,
  kind: 'USER' | 'ADMIN',
  extra: { mfaVerified?: boolean; activeBusinessId?: string | null } = {},
) {
  const token = randomToken(32);
  const ttlHours = kind === 'ADMIN' ? config.ADMIN_SESSION_TTL_HOURS : config.SESSION_TTL_HOURS;
  const session = await prisma.session.create({
    data: {
      tokenHash: sha256Hex(token),
      userId: user.id,
      kind,
      csrfToken: randomToken(24),
      mfaVerified: extra.mfaVerified ?? false,
      activeBusinessId: extra.activeBusinessId ?? null,
      ip: req.ip,
      userAgent: req.headers['user-agent']?.slice(0, 300),
      expiresAt: new Date(Date.now() + ttlHours * 3600_000),
    },
  });
  reply.setCookie(kind === 'ADMIN' ? ADMIN_COOKIE : USER_COOKIE, token, cookieOpts(kind, ttlHours * 3600));
  return session;
}

export function clearSessionCookie(reply: FastifyReply, kind: 'USER' | 'ADMIN') {
  reply.clearCookie(kind === 'ADMIN' ? ADMIN_COOKIE : USER_COOKIE, { path: kind === 'ADMIN' ? '/api/admin' : '/api' });
}

export async function loadSession(req: FastifyRequest, kind: 'USER' | 'ADMIN') {
  const token = req.cookies[kind === 'ADMIN' ? ADMIN_COOKIE : USER_COOKIE];
  if (!token) return null;
  const session = await prisma.session.findUnique({ where: { tokenHash: sha256Hex(token) }, include: { user: true } });
  if (!session || session.kind !== kind || session.revokedAt) return null;
  const now = Date.now();
  if (session.expiresAt.getTime() < now) return null;
  if (now - session.lastSeenAt.getTime() > IDLE_MINUTES[kind] * 60_000) {
    await prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    return null;
  }
  if (session.user.status !== 'ACTIVE') return null;
  if (now - session.lastSeenAt.getTime() > 60_000) {
    await prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } });
  }
  return session;
}

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);
export function checkCsrf(req: FastifyRequest, session: Session) {
  if (SAFE.has(req.method)) return;
  const h = req.headers['x-csrf-token'];
  if (typeof h !== 'string' || !safeEqual(h, session.csrfToken)) {
    throw new AppError(403, 'CSRF', 'Missing or invalid CSRF token. Reload the page and try again.');
  }
}

/** Unauthenticated state-changing endpoints (login/register) require this header (forces CORS preflight). */
export function checkAnonCsrf(req: FastifyRequest) {
  if (SAFE.has(req.method)) return;
  if (req.headers['x-requested-with'] !== 'InvoiceGO') throw new AppError(403, 'CSRF', 'Invalid request origin');
}

export async function requireUser(req: FastifyRequest) {
  const s = await loadSession(req, 'USER');
  if (!s) throw unauthorized();
  checkCsrf(req, s);
  // Two-factor users must complete the code step before the session can be used.
  if (s.user.totpEnabledAt && !s.mfaVerified) throw new AppError(401, 'MFA_REQUIRED', 'Enter your two-factor authentication code to continue.');
  let businessId = s.activeBusinessId;
  let role: MemberRole | null = null;
  const memberships = await prisma.membership.findMany({ where: { userId: s.userId }, orderBy: { createdAt: 'asc' } });
  const active = memberships.find((m) => m.businessId === businessId) ?? memberships[0];
  businessId = active?.businessId ?? null;
  role = active?.role ?? null;
  const { user, ...session } = s;
  req.auth = { kind: 'USER', session: session as Session, user, businessId, role };
}

export async function requireBusiness(req: FastifyRequest) {
  await requireUser(req);
  if (!req.auth!.businessId) throw new AppError(403, 'NO_BUSINESS', 'Create your business profile first');
}

export async function requireAdmin(req: FastifyRequest) {
  const s = await loadSession(req, 'ADMIN');
  if (!s) throw unauthorized('Administrator sign-in required');
  checkCsrf(req, s);
  if (s.user.platformRole === 'NONE') throw forbidden();
  if (!s.mfaVerified || !s.user.totpEnabledAt) throw new AppError(401, 'MFA_REQUIRED', 'Two-factor authentication required');
  const { user, ...session } = s;
  req.auth = { kind: 'ADMIN', session: session as Session, user, businessId: null, role: null };
}

// ---------------------------------------------------------------- permissions
export type MemberAction =
  | 'read'
  | 'invoice.write'
  | 'invoice.submit'
  | 'master.write'
  | 'fbr.manage'
  | 'business.manage'
  | 'reports';

const MEMBER_MATRIX: Record<MemberRole, MemberAction[]> = {
  OWNER: ['read', 'invoice.write', 'invoice.submit', 'master.write', 'fbr.manage', 'business.manage', 'reports'],
  ADMIN: ['read', 'invoice.write', 'invoice.submit', 'master.write', 'fbr.manage', 'business.manage', 'reports'],
  ACCOUNTANT: ['read', 'invoice.write', 'invoice.submit', 'master.write', 'reports'],
  OPERATOR: ['read', 'invoice.write', 'invoice.submit', 'master.write'],
  VIEWER: ['read', 'reports'],
};

export function requireMember(action: MemberAction) {
  return async (req: FastifyRequest) => {
    const role = req.auth?.role;
    if (!role || !MEMBER_MATRIX[role].includes(action)) throw forbidden();
  };
}

export type AdminPerm =
  | 'users.read'
  | 'users.manage'
  | 'users.delete'
  | 'invoices.read'
  | 'fbr.read'
  | 'fbr.retry'
  | 'reports.read'
  | 'support.read'
  | 'support.reply'
  | 'notifications.manage'
  | 'settings.read'
  | 'settings.manage'
  | 'security.read'
  | 'security.manage'
  | 'backups.manage';

const ADMIN_MATRIX: Record<Exclude<PlatformRole, 'NONE'>, AdminPerm[] | '*'> = {
  SUPER_ADMIN: '*',
  ADMIN: ['users.read', 'users.manage', 'invoices.read', 'fbr.read', 'fbr.retry', 'reports.read', 'support.read', 'support.reply', 'notifications.manage', 'settings.read', 'security.read'],
  SUPPORT: ['users.read', 'invoices.read', 'support.read', 'support.reply'],
  AUDITOR: ['users.read', 'invoices.read', 'fbr.read', 'reports.read', 'support.read', 'settings.read', 'security.read'],
};

export function adminCan(role: PlatformRole, perm: AdminPerm) {
  if (role === 'NONE') return false;
  const p = ADMIN_MATRIX[role];
  return p === '*' || p.includes(perm);
}

export function requireAdminPerm(perm: AdminPerm) {
  return async (req: FastifyRequest) => {
    if (!req.auth || req.auth.kind !== 'ADMIN' || !adminCan(req.auth.user.platformRole, perm)) throw forbidden();
  };
}

export function adminPermissions(role: PlatformRole): AdminPerm[] {
  const all: AdminPerm[] = ['users.read', 'users.manage', 'users.delete', 'invoices.read', 'fbr.read', 'fbr.retry', 'reports.read', 'support.read', 'support.reply', 'notifications.manage', 'settings.read', 'settings.manage', 'security.read', 'security.manage', 'backups.manage'];
  return all.filter((p) => adminCan(role, p));
}
