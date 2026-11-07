import { z } from 'zod';
import { resolveDatabaseUrl } from './lib/dbUrl.js';

/** Running on Vercel (serverless): no long-running worker, no pg_dump, HTTPS behind Vercel's proxy. */
export const onVercel = !!process.env.VERCEL;

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(8080),
  HOST: z.string().default('0.0.0.0'),
  APP_BASE_URL: z.string().url().default(defaultBaseUrl()),
  DATABASE_URL: z.string().min(1),
  /** 32-byte key, base64. Encrypts FBR tokens and TOTP secrets at rest. */
  DATA_ENCRYPTION_KEY: z.string().min(1),
  /** Optional previous key (base64) accepted for decryption during key rotation. */
  DATA_ENCRYPTION_KEY_PREVIOUS: z.string().optional(),
  SESSION_TTL_HOURS: z.coerce.number().default(12),
  ADMIN_SESSION_TTL_HOURS: z.coerce.number().default(4),
  COOKIE_SECURE: bool(true),
  TRUST_PROXY: bool(!!process.env.VERCEL),

  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_SECURE: bool(false),
  MAIL_FROM: z.string().default('InvoiceGO <no-reply@invoicego.com>'),
  /** Development only: write emails to the server log instead of sending. */
  MAIL_LOG_ONLY: bool(false),

  FBR_HTTP_CONNECT_TIMEOUT_MS: z.coerce.number().default(10000),
  FBR_HTTP_RESPONSE_TIMEOUT_MS: z.coerce.number().default(60000),
  /** Method for STATL / Get_Reg_Type (spec says GET but documents a JSON body — see SOURCE_CONFLICTS A5). */
  FBR_LOOKUP_METHOD: z.enum(['POST', 'GET']).default('POST'),
  /** Comma-separated https origins allowed for FBR calls. */
  FBR_ALLOWED_ORIGINS: z.string().default('https://gw.fbr.gov.pk'),
  /** Base for reference APIs (§5); must be one of the allowed origins. */
  FBR_REFERENCE_BASE_URL: z.string().default('https://gw.fbr.gov.pk'),
  /** Test-only escape hatch so the mock FBR server can be used; refused in production. */
  FBR_ALLOW_TEST_ORIGINS: z.string().optional(),

  /** Comma-separated static outbound IPs of this deployment (shown for IRIS whitelisting). */
  OUTBOUND_IPS: z.string().default(''),
  HOSTING_COMPANY: z.string().default(''),
  HOSTING_COUNTRY: z.string().default(''),

  BACKUP_DIR: z.string().default('./backups'),
  BACKUP_ENCRYPTION_KEY: z.string().optional(),
  PG_DUMP_PATH: z.string().default('pg_dump'),

  UPLOAD_MAX_BYTES: z.coerce.number().default(5 * 1024 * 1024),
  JOB_WORKER_ENABLED: bool(true),
  /** Minutes after which a RUNNING job whose worker vanished is re-queued (resumable, never re-submits accepted invoices). */
  JOB_ORPHAN_MINUTES: z.coerce.number().default(process.env.VERCEL ? 7 : 15),
  /** Optional HTTP(S) proxy with a STATIC egress IP used only for FBR calls (e.g. QuotaGuard Static, Fixie). */
  FBR_PROXY_URL: z.string().url().optional().or(z.literal('').transform(() => undefined)),
  /** One-time administrator bootstrap secret for hosts without shell access (Vercel). Remove after use. */
  ADMIN_BOOTSTRAP_TOKEN: z.string().optional(),
  ADMIN_BOOTSTRAP_EMAIL: z.string().email().default('admininvoicego@gmail.com'),
  /** Max duration of a serverless request (seconds); bulk FBR runs are sliced to fit (Vercel Hobby: 300). */
  FUNCTION_MAX_DURATION_S: z.coerce.number().default(300),
  /** Vercel Cron sends "Authorization: Bearer <CRON_SECRET>". */
  CRON_SECRET: z.string().optional(),
  LOG_LEVEL: z.string().default('info'),
  APP_VERSION: z.string().default('1.0.0'),
});

export type Config = z.infer<typeof schema>;

function defaultBaseUrl() {
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  return host ? `https://${host}` : 'http://localhost:8080';
}

function load(): Config {
  const parsed = schema.safeParse({ ...process.env, DATABASE_URL: resolveDatabaseUrl() ?? process.env.DATABASE_URL });
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  const cfg = parsed.data;
  const key = Buffer.from(cfg.DATA_ENCRYPTION_KEY, 'base64');
  if (key.length !== 32) throw new Error('DATA_ENCRYPTION_KEY must be 32 bytes encoded as base64');
  if (cfg.NODE_ENV === 'production') {
    if (cfg.FBR_ALLOW_TEST_ORIGINS) throw new Error('FBR_ALLOW_TEST_ORIGINS must not be set in production');
    if (cfg.MAIL_LOG_ONLY) throw new Error('MAIL_LOG_ONLY must not be enabled in production');
    if (!cfg.COOKIE_SECURE) throw new Error('COOKIE_SECURE must be true in production');
    if (cfg.ADMIN_BOOTSTRAP_TOKEN && cfg.ADMIN_BOOTSTRAP_TOKEN.length < 24) throw new Error('ADMIN_BOOTSTRAP_TOKEN must be at least 24 characters');
  }
  return cfg;
}

export const config: Config = load();
export const isProd = config.NODE_ENV === 'production';
export const isTest = config.NODE_ENV === 'test';
