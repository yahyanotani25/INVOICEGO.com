import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { FbrEnvironment } from '@prisma/client';
import { prisma } from '../../db.js';
import { config } from '../../config.js';
import { encryptSecret, maskLast4 } from '../../lib/crypto.js';
import { audit } from '../../lib/audit.js';
import { badRequest, conflict } from '../../lib/errors.js';
import { requireBusiness, requireMember } from '../../plugins/auth.js';
import { DEFAULT_URLS, EndpointError, validateInvoiceUrl } from '../../fbr/endpoints.js';
import { testConnection } from '../../fbr/service.js';
import { explainIssues } from '../../fbr/explain.js';

const envParam = z.object({ env: z.enum(['sandbox', 'production']).transform((e) => e.toUpperCase() as FbrEnvironment) });

async function credentialView(businessId: string) {
  const rows = await prisma.fbrCredential.findMany({ where: { businessId } });
  return (['SANDBOX', 'PRODUCTION'] as const).map((env) => {
    const c = rows.find((r) => r.environment === env);
    return {
      environment: env,
      postUrl: c?.postUrl ?? DEFAULT_URLS[env].postUrl,
      validateUrl: c?.validateUrl ?? DEFAULT_URLS[env].validateUrl,
      defaults: DEFAULT_URLS[env],
      tokenMasked: maskLast4(c?.tokenLast4),
      tokenSaved: !!c?.tokenEnc,
      tokenUpdatedAt: c?.tokenUpdatedAt ?? null,
      status: c?.status ?? 'UNTESTED',
      lastCheckedAt: c?.lastCheckedAt ?? null,
      lastCheckMessage: c?.lastCheckMessage ?? null,
      lastCheckHttpStatus: c?.lastCheckHttpStatus ?? null,
    };
  });
}

export async function fbrSettingsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireBusiness);

  app.get('/fbr/credentials', async (req) => {
    const b = await prisma.business.findUniqueOrThrow({ where: { id: req.auth!.businessId! } });
    return {
      credentials: await credentialView(req.auth!.businessId!),
      productionEnabled: b.productionEnabled,
      productionEnabledAt: b.productionEnabledAt,
      allowedOrigins: config.FBR_ALLOWED_ORIGINS.split(','),
    };
  });

  app.put('/fbr/credentials/:env', { preHandler: requireMember('fbr.manage') }, async (req) => {
    const { env } = envParam.parse(req.params);
    const body = z
      .object({
        postUrl: z.string().trim().max(300).optional(),
        validateUrl: z.string().trim().max(300).optional(),
        token: z.string().trim().min(8, 'Token looks too short').max(4000).optional(),
      })
      .parse(req.body);
    let postUrl: string, validateUrl: string;
    try {
      postUrl = validateInvoiceUrl(body.postUrl || DEFAULT_URLS[env].postUrl, env, 'post');
      validateUrl = validateInvoiceUrl(body.validateUrl || DEFAULT_URLS[env].validateUrl, env, 'validate');
    } catch (e) {
      if (e instanceof EndpointError) throw badRequest(e.message, { issues: [{ field: 'url', level: 'error', message: e.message }] });
      throw e;
    }
    const tokenData = body.token
      ? { tokenEnc: encryptSecret(body.token), tokenLast4: body.token.slice(-4), tokenUpdatedAt: new Date(), status: 'UNTESTED' as const, lastCheckedAt: null, lastCheckMessage: null, lastCheckHttpStatus: null }
      : {};
    const urlChanged = await prisma.fbrCredential.findUnique({ where: { businessId_environment: { businessId: req.auth!.businessId!, environment: env } } });
    await prisma.fbrCredential.upsert({
      where: { businessId_environment: { businessId: req.auth!.businessId!, environment: env } },
      create: { businessId: req.auth!.businessId!, environment: env, postUrl, validateUrl, updatedById: req.auth!.user.id, ...tokenData },
      update: {
        postUrl,
        validateUrl,
        updatedById: req.auth!.user.id,
        ...tokenData,
        ...(urlChanged && (urlChanged.postUrl !== postUrl || urlChanged.validateUrl !== validateUrl) && !body.token ? { status: 'UNTESTED' } : {}),
      },
    });
    if (env === 'PRODUCTION' && body.token) {
      // A replaced production token must be re-verified before production submission continues.
      await prisma.business.update({ where: { id: req.auth!.businessId! }, data: { productionEnabled: false, productionEnabledAt: null } });
    }
    await audit(req, { action: 'fbr.credential.update', entityType: 'FbrCredential', metadata: { environment: env, tokenReplaced: !!body.token, postUrl, validateUrl } });
    return { credentials: await credentialView(req.auth!.businessId!) };
  });

  app.delete('/fbr/credentials/:env/token', { preHandler: requireMember('fbr.manage') }, async (req) => {
    const { env } = envParam.parse(req.params);
    await prisma.fbrCredential.updateMany({
      where: { businessId: req.auth!.businessId!, environment: env },
      data: { tokenEnc: null, tokenLast4: null, status: 'UNTESTED', tokenUpdatedAt: new Date() },
    });
    if (env === 'PRODUCTION') await prisma.business.update({ where: { id: req.auth!.businessId! }, data: { productionEnabled: false, productionEnabledAt: null } });
    await audit(req, { action: 'fbr.credential.remove_token', entityType: 'FbrCredential', metadata: { environment: env } });
    return { credentials: await credentialView(req.auth!.businessId!) };
  });

  app.post('/fbr/credentials/:env/test', { preHandler: requireMember('fbr.manage'), config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const { env } = envParam.parse(req.params);
    const r = await testConnection(req.auth!.businessId!, env, req.auth!.user.id);
    await audit(req, { action: 'fbr.credential.test', entityType: 'FbrCredential', metadata: { environment: env, status: r.status, httpStatus: r.httpStatus } });
    return { result: r, credentials: await credentialView(req.auth!.businessId!) };
  });

  app.post('/fbr/production/enable', { preHandler: requireMember('fbr.manage') }, async (req) => {
    z.object({ confirm: z.literal(true) }).parse(req.body);
    const c = await prisma.fbrCredential.findUnique({ where: { businessId_environment: { businessId: req.auth!.businessId!, environment: 'PRODUCTION' } } });
    if (!c?.tokenEnc) throw conflict('Save the production token issued in IRIS first.');
    if (c.status !== 'OK') throw conflict('Run a successful production connection test before enabling production submission.');
    const b = await prisma.business.update({ where: { id: req.auth!.businessId! }, data: { productionEnabled: true, productionEnabledAt: new Date() } });
    await audit(req, { action: 'fbr.production.enable', entityType: 'Business', entityId: b.id });
    return { productionEnabled: true };
  });

  app.post('/fbr/production/disable', { preHandler: requireMember('fbr.manage') }, async (req) => {
    await prisma.business.update({ where: { id: req.auth!.businessId! }, data: { productionEnabled: false, productionEnabledAt: null } });
    await audit(req, { action: 'fbr.production.disable', entityType: 'Business', entityId: req.auth!.businessId! });
    return { productionEnabled: false };
  });

  app.get('/fbr/attempts', async (req) => {
    const q = z.object({ page: z.coerce.number().int().min(1).default(1), environment: z.enum(['SANDBOX', 'PRODUCTION', '']).default('') }).parse(req.query);
    const where = { businessId: req.auth!.businessId!, ...(q.environment ? { environment: q.environment } : {}) };
    const [total, rows] = await Promise.all([
      prisma.fbrAttempt.count({ where }),
      prisma.fbrAttempt.findMany({ where, orderBy: { startedAt: 'desc' }, skip: (q.page - 1) * 25, take: 25, include: { invoice: { select: { internalNumber: true } } } }),
    ]);
    return {
      total,
      rows: await Promise.all(
        rows.map(async (a) => ({
          id: a.id,
          operation: a.operation,
          environment: a.environment,
          invoiceId: a.invoiceId,
          internalNumber: a.invoice?.internalNumber ?? null,
          scenarioId: a.scenarioId,
          httpStatus: a.httpStatus,
          outcome: a.outcome,
          fbrInvoiceNo: a.fbrInvoiceNo,
          startedAt: a.startedAt,
          durationMs: a.durationMs,
          issues: await explainIssues((a.errors as never) ?? []),
        })),
      ),
    };
  });
}
