import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import fstatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { config, isProd, isTest, onVercel } from './config.js';
import { prisma } from './db.js';
import { maintenance, runOnce } from './jobs/runner.js';
import { registerBulkJobs } from './modules/bulk/service.js';
import { safeEqual } from './lib/crypto.js';
import { AppError } from './lib/errors.js';
import { authRoutes } from './modules/auth/routes.js';
import { businessRoutes } from './modules/business/routes.js';
import { customerRoutes } from './modules/customers/routes.js';
import { productRoutes } from './modules/products/routes.js';
import { catalogueRoutes } from './modules/catalogue/routes.js';
import { invoiceRoutes } from './modules/invoices/routes.js';
import { fbrSettingsRoutes } from './modules/fbrSettings/routes.js';
import { sandboxRoutes } from './modules/sandbox/routes.js';
import { bulkRoutes } from './modules/bulk/routes.js';
import { reportRoutes } from './modules/reports/routes.js';
import { supportRoutes } from './modules/support/routes.js';
import { notificationRoutes } from './modules/notifications/routes.js';
import { adminRoutes } from './modules/admin/routes.js';

const here = dirname(fileURLToPath(import.meta.url));

export const REDACT = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.token',
  '*.newPassword',
  '*.currentPassword',
];

export async function buildApp(): Promise<FastifyInstance> {
  registerBulkJobs();
  const app = Fastify({
    logger: isTest
      ? false
      : {
          level: config.LOG_LEVEL,
          redact: { paths: REDACT, censor: '[REDACTED]' },
          ...(isProd ? {} : { transport: { target: 'pino-pretty' } }),
        },
    trustProxy: config.TRUST_PROXY,
    bodyLimit: 2 * 1024 * 1024,
    disableRequestLogging: false,
  });

  await app.register(cookie);
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  });
  await app.register(rateLimit, { global: true, max: 300, timeWindow: '1 minute', allowList: isTest ? () => true : undefined });
  await app.register(multipart, { limits: { fileSize: config.UPLOAD_MAX_BYTES, files: 1, fields: 20 } });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      return reply.status(err.status).send({ error: { code: err.code, message: err.message, details: err.details } });
    }
    if (err instanceof ZodError) {
      return reply.status(400).send({
        error: {
          code: 'INVALID_INPUT',
          message: 'Some fields are invalid',
          details: { issues: err.issues.map((i) => ({ field: i.path.join('.'), level: 'error', message: i.message })) },
        },
      });
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return reply.status(409).send({ error: { code: 'DUPLICATE', message: 'A record with the same unique value already exists' } });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) {
      return reply.status(status).send({ error: { code: (err as { code?: string }).code ?? 'REQUEST_ERROR', message: err.message } });
    }
    req.log.error({ err }, 'Unhandled error');
    return reply.status(500).send({ error: { code: 'INTERNAL', message: 'An unexpected error occurred. It has been logged.' } });
  });

  app.get('/api/health', async (_req, reply) => {
    let db: 'ok' | 'error' = 'ok';
    let referenceData = false;
    try {
      referenceData = (await prisma.scenarioDefinition.count()) === 28;
    } catch {
      db = 'error';
    }
    return reply.status(db === 'ok' ? 200 : 503).send({ ok: db === 'ok', db, referenceData, version: config.APP_VERSION, time: new Date().toISOString() });
  });

  // Opportunistic maintenance (stale submission locks, orphaned job slices). Rate-limited per instance.
  if (!isTest) {
    app.addHook('onResponse', async () => {
      void maintenance().catch(() => {});
    });
  }

  /** Vercel Cron (or any scheduler): maintenance plus one slice of queued background work. */
  app.get('/api/cron/maintenance', async (req, reply) => {
    const auth = req.headers.authorization ?? '';
    if (!config.CRON_SECRET || !safeEqual(auth, `Bearer ${config.CRON_SECRET}`)) {
      return reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Invalid cron secret' } });
    }
    await maintenance(true);
    const budget = onVercel ? Math.max(15_000, config.FUNCTION_MAX_DURATION_S * 1000 - 2 * (config.FBR_HTTP_CONNECT_TIMEOUT_MS + config.FBR_HTTP_RESPONSE_TIMEOUT_MS) - 15_000) : 60_000;
    const r = await runOnce(budget);
    return { ok: true, job: r };
  });

  await app.register(authRoutes, { prefix: '/api' });
  await app.register(businessRoutes, { prefix: '/api/app' });
  await app.register(customerRoutes, { prefix: '/api/app' });
  await app.register(productRoutes, { prefix: '/api/app' });
  await app.register(catalogueRoutes, { prefix: '/api/app' });
  await app.register(invoiceRoutes, { prefix: '/api/app' });
  await app.register(fbrSettingsRoutes, { prefix: '/api/app' });
  await app.register(sandboxRoutes, { prefix: '/api/app' });
  await app.register(bulkRoutes, { prefix: '/api/app' });
  await app.register(reportRoutes, { prefix: '/api/app' });
  await app.register(supportRoutes, { prefix: '/api/app' });
  await app.register(notificationRoutes, { prefix: '/api/app' });
  await app.register(adminRoutes, { prefix: '/api/admin' });

  // Built SPA (web/dist copied to server/public at build time)
  const publicDir = [join(here, '..', 'public'), join(here, '..', '..', 'public')].find((p) => existsSync(join(p, 'index.html')));
  if (publicDir) {
    await app.register(fstatic, { root: publicDir, prefix: '/', wildcard: false, index: false, maxAge: '1h' });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Not found' } });
      return reply.type('text/html').header('cache-control', 'no-cache').sendFile('index.html');
    });
  } else {
    app.setNotFoundHandler((req, reply) => reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Not found' } }));
  }
  return app;
}
