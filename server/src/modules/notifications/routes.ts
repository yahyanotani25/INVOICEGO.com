import type { FastifyInstance } from 'fastify';
import { prisma } from '../../db.js';
import { requireBusiness } from '../../plugins/auth.js';

export async function notificationRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireBusiness);

  app.get('/notifications', async (req) => {
    const now = new Date();
    const [items, unread, announcements] = await Promise.all([
      prisma.notification.findMany({ where: { userId: req.auth!.user.id, audience: 'USER' }, orderBy: { createdAt: 'desc' }, take: 50 }),
      prisma.notification.count({ where: { userId: req.auth!.user.id, audience: 'USER', readAt: null } }),
      prisma.announcement.findMany({ where: { active: true, startsAt: { lte: now }, OR: [{ endsAt: null }, { endsAt: { gt: now } }] }, orderBy: { createdAt: 'desc' }, take: 10 }),
    ]);
    return { items, unread, announcements };
  });

  app.post('/notifications/:id/read', async (req) => {
    await prisma.notification.updateMany({ where: { id: (req.params as { id: string }).id, userId: req.auth!.user.id }, data: { readAt: new Date() } });
    return { ok: true };
  });

  app.post('/notifications/read-all', async (req) => {
    await prisma.notification.updateMany({ where: { userId: req.auth!.user.id, readAt: null }, data: { readAt: new Date() } });
    return { ok: true };
  });
}
