import { z } from 'zod';

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(8080),
  HOST: z.string().default('0.0.0.0'),
  APP_BASE_URL: z.string().url().default('http://localhost:8080'),
  DATABASE_URL: z.string().min(1),
  /** 32-byte key, base64. Encrypts FBR tokens and TOTP secrets at rest. */
  DATA_ENCRYPTION_KEY: z.string().min(1),
  /** Optional previous key (base64) accepted for decryption during key rotation. */
  DATA_ENCRYPTION_KEY_PREVIOUS: z.string().optional(),
  SESSION_TTL_HOURS: z.coerce.number().default(12),
  ADMIN_SESSION_TTL_HOURS: z.coerce.number().default(4),
  COOKIE_SECURE: bool(true),
  TRUST_PROXY: bool(false),

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
  LOG_LEVEL: z.string().default('info'),
  APP_VERSION: z.string().default('1.0.0'),
});

export type Config = z.infer<typeof schema>;

function load(): Config {
  const parsed = schema.safeParse(process.env);
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
  }
  return cfg;
}

export const config: Config = load();
export const isProd = config.NODE_ENV === 'production';
export const isTest = config.NODE_ENV === 'test';
