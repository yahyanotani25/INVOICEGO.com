import type { PlatformRole } from '@prisma/client';
import { prisma } from '../../db.js';
import { config } from '../../config.js';
import { issueEmailToken } from '../auth/routes.js';

/**
 * Server-controlled administrator provisioning. Admin access is NEVER granted by public
 * registration: only this function (via the CLI or an existing SUPER_ADMIN) can create it.
 */
export async function createAdminInvite(email: string, role: Exclude<PlatformRole, 'NONE'>, opts: { createdById?: string; allowUpgradeExisting?: boolean } = {}) {
  const normalized = email.trim().toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email: normalized }, include: { memberships: true } });
  let userId: string;
  if (existing) {
    if (existing.platformRole === 'NONE' && (existing.memberships.length > 0 || existing.passwordHash) && !opts.allowUpgradeExisting) {
      throw new Error(`${normalized} already belongs to a business user account. Re-run with --upgrade-existing to convert it deliberately.`);
    }
    const u = await prisma.user.update({
      where: { id: existing.id },
      data: { platformRole: role, ...(existing.platformRole === 'NONE' ? { status: 'INACTIVE', passwordHash: null, totpSecretEnc: null, totpEnabledAt: null } : {}) },
    });
    userId = u.id;
  } else {
    const u = await prisma.user.create({ data: { email: normalized, name: 'Administrator', platformRole: role, status: 'INACTIVE' } });
    userId = u.id;
  }
  const token = await issueEmailToken(userId, 'ADMIN_INVITE', 24, opts.createdById);
  await prisma.auditLog.create({
    data: { action: 'admin.invite', actorKind: opts.createdById ? 'ADMIN' : 'SYSTEM', actorUserId: opts.createdById, entityType: 'User', entityId: userId, metadata: { email: normalized, role } },
  });
  return { userId, url: `${config.APP_BASE_URL}/admin/accept-invite?token=${token}`, expiresInHours: 24 };
}
