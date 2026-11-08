import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { MemberRole } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../db.js';
import { config } from '../../config.js';
import { randomToken, sha256Hex } from '../../lib/crypto.js';
import { AppError, badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
import { hashPassword, passwordProblems } from '../../lib/password.js';
import { mailConfigured, sendMail } from '../../lib/mailer.js';
import { audit } from '../../lib/audit.js';
import { zTrim } from '../../lib/validators.js';
import { checkAnonCsrf, createSession, requireBusiness, requireMember } from '../../plugins/auth.js';
import { notifyUser } from '../notifications/notify.js';
import { RESERVED_ADMIN_EMAILS, meDto, passwordLogin } from '../auth/routes.js';

/**
 * Business team management. Owners and admins invite people by email with a role; the invitee
 * accepts through a single-use link (only its hash is stored). Owners can never be invited,
 * changed or removed through this flow, and admins cannot manage other admins.
 */

const INVITE_DAYS = 7;
const MAX_PENDING_INVITES = 50;
const ASSIGNABLE = ['ADMIN', 'ACCOUNTANT', 'OPERATOR', 'VIEWER'] as const;

export const ROLE_DESCRIPTIONS: Record<MemberRole, string> = {
  OWNER: 'Owner — full control of the business, its FBR credentials and its team',
  ADMIN: 'Admin — manages the business profile, FBR credentials and team members',
  ACCOUNTANT: 'Accountant — creates, validates and submits invoices and sees reports',
  OPERATOR: 'Operator — creates, validates and submits invoices',
  VIEWER: 'Viewer — read-only access to invoices and reports',
};

/** Which roles the actor may assign, and whose membership the actor may change. */
export function canAssign(actor: MemberRole, role: MemberRole) {
  if (role === 'OWNER') return false;
  if (role === 'ADMIN') return actor === 'OWNER';
  return actor === 'OWNER' || actor === 'ADMIN';
}
function canManageMember(actor: MemberRole, target: MemberRole) {
  if (target === 'OWNER') return false;
  if (target === 'ADMIN') return actor === 'OWNER';
  return actor === 'OWNER' || actor === 'ADMIN';
}

const inviteUrl = (token: string) => `${config.APP_BASE_URL}/accept-invite?token=${token}`;

async function sendInviteEmail(req: FastifyRequest, to: string, businessName: string, inviterName: string, role: MemberRole, token: string) {
  const text = [
    'Hello,',
    '',
    `${inviterName} has invited you to join ${businessName} on InvoiceGO.`,
    `Your role: ${ROLE_DESCRIPTIONS[role]}.`,
    '',
    `Accept the invitation (valid for ${INVITE_DAYS} days):`,
    inviteUrl(token),
    '',
    'If you were not expecting this invitation, you can ignore this email.',
  ].join('\n');
  await sendMail(to, `You're invited to join ${businessName} on InvoiceGO`, text, req.log);
}

/** Emails the invitation when SMTP is configured; otherwise (or on failure) returns the link to share. */
async function deliverInvite(req: FastifyRequest, email: string, businessName: string, inviterName: string, role: MemberRole, token: string) {
  if (mailConfigured()) {
    try {
      await sendInviteEmail(req, email, businessName, inviterName, role, token);
      return { emailed: true as const };
    } catch (e) {
      req.log.error({ err: (e as Error).message }, 'team invitation email could not be sent');
    }
  }
  return { emailed: false as const, url: inviteUrl(token), message: 'The invitation email could not be sent. Copy the link and send it to the person yourself. It works once and expires in 7 days.' };
}

function inviteState(i: { acceptedAt: Date | null; revokedAt: Date | null; expiresAt: Date }) {
  if (i.acceptedAt) return 'ACCEPTED';
  if (i.revokedAt) return 'REVOKED';
  if (i.expiresAt < new Date()) return 'EXPIRED';
  return 'PENDING';
}

export async function teamRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireBusiness);
  const manage = requireMember('business.manage');

  app.get('/team', async (req) => {
    const { businessId, role, user } = req.auth!;
    const [members, invites] = await Promise.all([
      prisma.membership.findMany({ where: { businessId: businessId! }, include: { user: true }, orderBy: { createdAt: 'asc' } }),
      prisma.teamInvite.findMany({ where: { businessId: businessId!, acceptedAt: null, revokedAt: null }, orderBy: { createdAt: 'desc' } }),
    ]);
    const inviterIds = [...new Set(invites.map((i) => i.invitedById))];
    const inviters = await prisma.user.findMany({ where: { id: { in: inviterIds } }, select: { id: true, name: true } });
    const isManager = role === 'OWNER' || role === 'ADMIN';
    return {
      yourRole: role,
      canManage: isManager,
      assignableRoles: ASSIGNABLE.filter((r) => canAssign(role!, r)),
      roleDescriptions: ROLE_DESCRIPTIONS,
      members: members.map((m) => ({
        id: m.id,
        userId: m.userId,
        name: m.user.name,
        email: m.user.email,
        role: m.role,
        status: m.user.status,
        mfaEnabled: !!m.user.totpEnabledAt,
        joinedAt: m.createdAt,
        isYou: m.userId === user.id,
        canChange: isManager && m.userId !== user.id && canManageMember(role!, m.role),
      })),
      invites: isManager
        ? invites.map((i) => ({ id: i.id, email: i.email, role: i.role, state: inviteState(i), createdAt: i.createdAt, expiresAt: i.expiresAt, invitedBy: inviters.find((u) => u.id === i.invitedById)?.name ?? null, canChange: canAssign(role!, i.role) }))
        : [],
    };
  });

  app.post('/team/invites', { preHandler: manage, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { businessId, role: actorRole, user } = req.auth!;
    const body = z.object({ email: z.string().trim().toLowerCase().email().max(200), role: z.enum(ASSIGNABLE) }).parse(req.body);
    if (!canAssign(actorRole!, body.role)) throw forbidden(body.role === 'ADMIN' ? 'Only the owner can invite admins.' : 'You cannot assign this role.');
    if (RESERVED_ADMIN_EMAILS.includes(body.email)) throw badRequest('This email address cannot join a business.', { issues: [{ field: 'email', level: 'error', message: 'This email address cannot join a business.' }] });
    const existing = await prisma.user.findUnique({ where: { email: body.email }, include: { memberships: { where: { businessId: businessId! } } } });
    if (existing?.platformRole && existing.platformRole !== 'NONE') throw badRequest('This email belongs to a platform administrator account and cannot join a business.', { issues: [{ field: 'email', level: 'error', message: 'Administrator accounts cannot join a business.' }] });
    if (existing?.memberships.length) throw conflict(`${body.email} is already a member of this business.`, { issues: [{ field: 'email', level: 'error', message: 'Already a member' }] }, 'ALREADY_MEMBER');
    if (existing && ['SUSPENDED', 'BLOCKED', 'DELETED'].includes(existing.status)) throw badRequest('This account cannot be invited. Contact support.', { issues: [{ field: 'email', level: 'error', message: 'This account cannot be invited' }] });
    const pending = await prisma.teamInvite.count({ where: { businessId: businessId!, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } } });
    if (pending >= MAX_PENDING_INVITES) throw badRequest(`You have ${MAX_PENDING_INVITES} pending invitations. Revoke some before inviting more people.`);
    const token = randomToken(32);
    const business = await prisma.business.findUniqueOrThrow({ where: { id: businessId! }, select: { name: true } });
    const invite = await prisma.$transaction(async (tx) => {
      await tx.teamInvite.updateMany({ where: { businessId: businessId!, email: body.email, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
      return tx.teamInvite.create({ data: { businessId: businessId!, email: body.email, role: body.role, tokenHash: sha256Hex(token), invitedById: user.id, expiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000) } });
    });
    const delivery = await deliverInvite(req, body.email, business.name, user.name, body.role, token);
    await audit(req, { action: 'team.invite', entityType: 'TeamInvite', entityId: invite.id, metadata: { email: body.email, role: body.role, emailed: delivery.emailed } });
    return reply.status(201).send({ id: invite.id, email: invite.email, role: invite.role, expiresAt: invite.expiresAt, ...delivery });
  });

  app.post('/team/invites/:id/resend', { preHandler: manage, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) => {
    const { businessId, role: actorRole, user } = req.auth!;
    const { id } = req.params as { id: string };
    const inv = await prisma.teamInvite.findFirst({ where: { id, businessId: businessId!, acceptedAt: null, revokedAt: null } });
    if (!inv) throw notFound('Invitation');
    if (!canAssign(actorRole!, inv.role)) throw forbidden();
    const token = randomToken(32);
    await prisma.teamInvite.update({ where: { id }, data: { tokenHash: sha256Hex(token), expiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000) } });
    const business = await prisma.business.findUniqueOrThrow({ where: { id: businessId! }, select: { name: true } });
    const delivery = await deliverInvite(req, inv.email, business.name, user.name, inv.role, token);
    await audit(req, { action: 'team.invite_resend', entityType: 'TeamInvite', entityId: id, metadata: { emailed: delivery.emailed } });
    return { ok: true, ...delivery };
  });

  app.delete('/team/invites/:id', { preHandler: manage }, async (req) => {
    const { businessId, role: actorRole } = req.auth!;
    const { id } = req.params as { id: string };
    const inv = await prisma.teamInvite.findFirst({ where: { id, businessId: businessId!, acceptedAt: null, revokedAt: null } });
    if (!inv) throw notFound('Invitation');
    if (!canAssign(actorRole!, inv.role)) throw forbidden();
    await prisma.teamInvite.update({ where: { id }, data: { revokedAt: new Date() } });
    await audit(req, { action: 'team.invite_revoke', entityType: 'TeamInvite', entityId: id, metadata: { email: inv.email } });
    return { ok: true };
  });

  app.patch('/team/members/:id', { preHandler: manage }, async (req) => {
    const { businessId, role: actorRole, user } = req.auth!;
    const { id } = req.params as { id: string };
    const { role } = z.object({ role: z.enum(ASSIGNABLE) }).parse(req.body);
    const m = await prisma.membership.findFirst({ where: { id, businessId: businessId! }, include: { business: { select: { name: true } } } });
    if (!m) throw notFound('Team member');
    if (m.userId === user.id) throw badRequest('You cannot change your own role.');
    if (!canManageMember(actorRole!, m.role) || !canAssign(actorRole!, role)) throw forbidden(m.role === 'OWNER' ? 'The owner’s role cannot be changed.' : 'You cannot make this change.');
    if (m.role === role) return { ok: true };
    await prisma.membership.update({ where: { id }, data: { role } });
    await audit(req, { action: 'team.role_change', entityType: 'Membership', entityId: id, metadata: { userId: m.userId, from: m.role, to: role } });
    await notifyUser(m.userId, 'TEAM', `Your role in ${m.business.name} changed`, `${user.name} changed your role from ${m.role} to ${role}. ${ROLE_DESCRIPTIONS[role]}.`, '/app', { log: req.log });
    return { ok: true };
  });

  app.delete('/team/members/:id', { preHandler: manage }, async (req) => {
    const { businessId, role: actorRole, user } = req.auth!;
    const { id } = req.params as { id: string };
    const m = await prisma.membership.findFirst({ where: { id, businessId: businessId! }, include: { business: { select: { name: true } } } });
    if (!m) throw notFound('Team member');
    if (m.userId === user.id) throw badRequest('You cannot remove yourself. Use “Leave business” instead.');
    if (!canManageMember(actorRole!, m.role)) throw forbidden(m.role === 'OWNER' ? 'The owner cannot be removed.' : 'You cannot remove this member.');
    await removeMembership(m.id, m.userId, businessId!);
    await audit(req, { action: 'team.remove', entityType: 'Membership', entityId: id, metadata: { userId: m.userId, role: m.role } });
    await notifyUser(m.userId, 'TEAM', `You were removed from ${m.business.name}`, `${user.name} removed your access to ${m.business.name} on InvoiceGO.`, undefined, { log: req.log });
    return { ok: true };
  });

  app.post('/team/leave', async (req) => {
    const { businessId, role, user } = req.auth!;
    if (role === 'OWNER') throw badRequest('The owner cannot leave the business.');
    const m = await prisma.membership.findUnique({ where: { userId_businessId: { userId: user.id, businessId: businessId! } } });
    if (!m) throw notFound('Membership');
    await removeMembership(m.id, user.id, businessId!);
    await audit(req, { action: 'team.leave', entityType: 'Membership', entityId: m.id, metadata: { role } });
    return { ok: true };
  });
}

async function removeMembership(membershipId: string, userId: string, businessId: string) {
  await prisma.$transaction([
    prisma.membership.delete({ where: { id: membershipId } }),
    // Sessions pointing at this business fall back to the user's other businesses (if any).
    prisma.session.updateMany({ where: { userId, activeBusinessId: businessId }, data: { activeBusinessId: null } }),
  ]);
}

// ---------------------------------------------------------------- accepting an invitation (no session needed)

async function findValidInvite(token: string) {
  const inv = await prisma.teamInvite.findUnique({ where: { tokenHash: sha256Hex(token) }, include: { business: { select: { id: true, name: true } } } });
  const state = inv ? inviteState(inv) : 'INVALID';
  if (!inv || state !== 'PENDING') {
    const msg = state === 'ACCEPTED' ? 'This invitation has already been accepted. Sign in to continue.' : state === 'EXPIRED' ? 'This invitation has expired. Ask the business owner to send a new one.' : 'This invitation link is not valid. It may have been revoked or replaced by a newer one.';
    throw badRequest(msg, undefined, 'INVITE_INVALID');
  }
  return inv;
}

export async function teamInviteAcceptRoutes(app: FastifyInstance) {
  const strict = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };

  app.get('/auth/team-invite', strict, async (req) => {
    const { token } = z.object({ token: z.string().min(20).max(200) }).parse(req.query);
    const inv = await findValidInvite(token);
    const [inviter, account] = await Promise.all([
      prisma.user.findUnique({ where: { id: inv.invitedById }, select: { name: true } }),
      prisma.user.findUnique({ where: { email: inv.email }, select: { status: true, platformRole: true } }),
    ]);
    return {
      businessName: inv.business.name,
      email: inv.email,
      role: inv.role,
      roleDescription: ROLE_DESCRIPTIONS[inv.role],
      invitedBy: inviter?.name ?? null,
      expiresAt: inv.expiresAt,
      accountExists: !!account && account.platformRole === 'NONE' && account.status !== 'DELETED',
    };
  });

  app.post('/auth/team-invite/accept', strict, async (req, reply) => {
    checkAnonCsrf(req);
    const body = z
      .object({ token: z.string().min(20).max(200), password: z.string().min(1).max(200), name: zTrim(120).min(2).optional(), phone: zTrim(30).min(7).optional() })
      .parse(req.body);
    const inv = await findValidInvite(body.token);
    let user = await prisma.user.findUnique({ where: { email: inv.email } });

    if (user && (user.platformRole !== 'NONE' || user.status === 'DELETED')) throw badRequest('This invitation cannot be accepted with this email address. Contact support.', undefined, 'INVITE_INVALID');

    if (user) {
      // Existing account: the person proves it is theirs with the account password.
      try {
        user = await passwordLogin(req, inv.email, body.password, 'USER');
      } catch (e) {
        // A correct password on an unverified account: the invitation link proves the email address.
        if (!(e instanceof AppError && e.code === 'EMAIL_NOT_VERIFIED')) throw e;
        user = await prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date(), status: 'ACTIVE', failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } });
      }
    } else {
      if (!body.name || !body.phone) {
        throw badRequest('Enter your name and phone number to create your account.', {
          issues: [
            ...(!body.name ? [{ field: 'name', level: 'error', message: 'Name is required' }] : []),
            ...(!body.phone ? [{ field: 'phone', level: 'error', message: 'Phone number is required' }] : []),
          ],
        });
      }
      const pwp = passwordProblems(body.password);
      if (pwp) throw badRequest(pwp, { issues: [{ field: 'password', level: 'error', message: pwp }] });
    }
    const newAccount = user ? null : { name: body.name!, phone: body.phone!, passwordHash: await hashPassword(body.password) };

    // Claiming the invitation, creating the account (if new) and the membership happen together.
    const joined = await prisma.$transaction(async (tx) => {
      const account =
        user ??
        // The invitation link was delivered to this address, so the email counts as verified.
        (await tx.user.create({ data: { email: inv.email, ...newAccount!, status: 'ACTIVE', emailVerifiedAt: new Date(), lastLoginAt: new Date() } }));
      const claimed = await tx.teamInvite.updateMany({ where: { id: inv.id, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } }, data: { acceptedAt: new Date(), acceptedById: account.id } });
      if (claimed.count !== 1) throw badRequest('This invitation is no longer valid.', undefined, 'INVITE_INVALID');
      await tx.membership.upsert({ where: { userId_businessId: { userId: account.id, businessId: inv.businessId } }, create: { userId: account.id, businessId: inv.businessId, role: inv.role }, update: {} });
      return account;
    });
    user = joined;

    await audit(req, { action: 'team.invite_accept', entityType: 'TeamInvite', entityId: inv.id, businessId: inv.businessId, metadata: { role: inv.role } }, { userId: user.id, kind: 'USER' });
    await notifyUser(inv.invitedById, 'TEAM', `${user.name} joined ${inv.business.name}`, `${user.name} (${user.email}) accepted your invitation and joined as ${inv.role}.`, '/app/settings', { log: req.log });

    const session = await createSession(req, reply, user, 'USER', { activeBusinessId: inv.businessId, mfaVerified: false });
    if (user.totpEnabledAt) return { mfaRequired: true, csrfToken: session.csrfToken };
    return meDto(user.id, session.id, session.csrfToken, inv.businessId);
  });
}
