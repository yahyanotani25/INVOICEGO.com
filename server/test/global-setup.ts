/** Migrates the dedicated test database and imports the supplied reference datasets once. */
import { execSync } from 'node:child_process';
import { TEST_ENV } from './env';

export default function setup() {
  const env = { ...process.env, ...TEST_ENV };
  for (const k of ['HTTPS_PROXY', 'HTTP_PROXY', 'https_proxy', 'http_proxy']) delete env[k];
  const cwd = new URL('..', import.meta.url).pathname;
  execSync('npx prisma migrate deploy', { cwd, env, stdio: 'pipe' });
  execSync('npx tsx scripts/import-reference-data.ts', { cwd, env, stdio: 'pipe' });
}
