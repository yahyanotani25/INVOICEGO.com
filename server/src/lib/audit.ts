import type { FastifyRequest } from 'fastify';
import { prisma } from '../db.js';

export interface AuditInput {
  action: string;
  entityType?: string;
  entityId?: string;
  businessId?: string | null;
  metadata?: Record<string, unknown>;
}

/** Append-only audit trail. Never pass secrets in metadata. */
export async function audit(req: FastifyRequest | null, input: AuditInput, actor?: { userId?: string | null; kind?: string }) {
  const a = req?.auth;
  await prisma.auditLog.create({
    data: {
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      businessId: input.businessId ?? a?.businessId ?? null,
      actorUserId: actor?.userId ?? a?.user.id ?? null,
      actorKind: actor?.kind ?? (a ? (a.kind === 'ADMIN' ? 'ADMIN' : 'USER') : 'SYSTEM'),
      metadata: (input.metadata ?? undefined) as any,
      ip: req?.ip,
      userAgent: req?.headers['user-agent']?.slice(0, 300),
    },
  });
}
