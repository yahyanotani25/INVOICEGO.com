/** Shared test environment (used by global setup and per-file setup). */
export const TEST_DB = 'postgresql://invoicego:invoicego_dev@localhost:5432/invoicego_test';
export const MOCK_PORT = 18555;
export const MOCK_ORIGIN = `http://127.0.0.1:${MOCK_PORT}`;

export const TEST_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  DATABASE_URL: TEST_DB,
  DATA_ENCRYPTION_KEY: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=',
  BACKUP_ENCRYPTION_KEY: 'ZmVkY2JhOTg3NjU0MzIxMGZlZGNiYTk4NzY1NDMyMTA=',
  COOKIE_SECURE: 'false',
  FBR_ALLOW_TEST_ORIGINS: MOCK_ORIGIN,
  FBR_REFERENCE_BASE_URL: MOCK_ORIGIN,
  FBR_ALLOWED_ORIGINS: 'https://gw.fbr.gov.pk',
  FBR_HTTP_CONNECT_TIMEOUT_MS: '2000',
  FBR_HTTP_RESPONSE_TIMEOUT_MS: '1500',
  JOB_WORKER_ENABLED: 'false',
  APP_BASE_URL: 'http://localhost',
  MAIL_LOG_ONLY: 'false',
  NO_PROXY: '127.0.0.1,localhost',
  ADMIN_BOOTSTRAP_TOKEN: 'test-bootstrap-token-0123456789abcdef',
  CRON_SECRET: 'test-cron-secret-0123456789',
  no_proxy: '127.0.0.1,localhost',
};

export function applyTestEnv() {
  for (const k of ['HTTPS_PROXY', 'HTTP_PROXY', 'https_proxy', 'http_proxy', 'SMTP_HOST']) delete process.env[k];
  Object.assign(process.env, TEST_ENV);
}
