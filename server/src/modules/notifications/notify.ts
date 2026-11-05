import { prisma } from '../../db.js';

/** Notify every member of a business. */
export async function notifyBusiness(businessId: string, type: string, title: string, body: string, link?: string) {
  const members = await prisma.membership.findMany({ where: { businessId }, select: { userId: true } });
  if (members.length === 0) return;
  await prisma.notification.createMany({
    data: members.map((m) => ({ userId: m.userId, businessId, audience: 'USER', type, title, body, link })),
  });
}

/** Notify platform administrators (shown in the admin panel). */
export async function notifyAdmins(type: string, title: string, body: string, link?: string, businessId?: string) {
  await prisma.notification.create({ data: { audience: 'ADMINS', type, title, body, link, businessId } });
}

export async function notifyUser(userId: string, type: string, title: string, body: string, link?: string) {
  await prisma.notification.create({ data: { userId, audience: 'USER', type, title, body, link } });
}
