import type { FastifyInstance } from 'fastify';
import { prisma } from '../../db.js';

interface PlatformSetting {
  softwareName?: string;
  companyName?: string;
  companyAddress?: string;
  supportEmail?: string;
  supportPhone?: string;
  logoText?: string;
}

/** Public, unauthenticated platform branding (name, support contact, logo). No tenant data. */
export async function publicRoutes(app: FastifyInstance) {
  app.get('/branding', async (_req, reply) => {
    const [setting, logo] = await Promise.all([
      prisma.systemSetting.findUnique({ where: { key: 'platform' } }),
      prisma.platformAsset.findUnique({ where: { key: 'logo' }, select: { updatedAt: true } }),
    ]);
    const p = (setting?.value ?? {}) as PlatformSetting;
    reply.header('cache-control', 'public, max-age=60');
    return {
      softwareName: p.softwareName?.trim() || 'InvoiceGO',
      companyName: p.companyName?.trim() || null,
      companyAddress: p.companyAddress?.trim() || null,
      supportEmail: p.supportEmail?.trim() || null,
      supportPhone: p.supportPhone?.trim() || null,
      logoText: p.logoText?.trim() || null,
      logoUrl: logo ? `/api/public/logo?v=${logo.updatedAt.getTime()}` : null,
    };
  });

  app.get('/logo', async (_req, reply) => {
    const logo = await prisma.platformAsset.findUnique({ where: { key: 'logo' } });
    if (!logo) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'No logo has been uploaded' } });
    return reply
      .type(logo.mime)
      .header('cache-control', 'public, max-age=3600')
      .header('x-content-type-options', 'nosniff')
      .send(Buffer.from(logo.data));
  });
}
