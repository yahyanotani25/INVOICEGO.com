/**
 * Vercel build: web SPA + compiled API + database migrations and reference-data import.
 * Database steps run only when a database is connected (Neon/Vercel Postgres variables),
 * always against the DIRECT (non-pooled) connection.
 */
import { execSync } from 'node:child_process';

const run = (cmd, opts = {}) => {
  console.log(`\n▶ ${cmd}`);
  execSync(cmd, { stdio: 'inherit', ...opts, env: { ...process.env, ...(opts.env ?? {}) } });
};

run('npm run build', { cwd: 'web' });
run('npx prisma generate', { cwd: 'server' });
run('npm run build', { cwd: 'server' });
// Fails the build (keeping the current production deployment live) if the API could not start.
run('node --no-experimental-require-module scripts/check-api-loads.mjs');

const direct =
  process.env.DATABASE_URL_UNPOOLED || process.env.POSTGRES_URL_NON_POOLING || process.env.DIRECT_URL || process.env.DATABASE_URL || process.env.POSTGRES_URL;

if (!direct) {
  console.warn('\n⚠ No database is connected (DATABASE_URL / DATABASE_URL_UNPOOLED not set).');
  console.warn('  The site will deploy, but the API will report "Server is not configured" until a database is added.');
  console.warn('  Vercel → Project → Storage → Create Database → Neon (Postgres) → Connect, then redeploy.\n');
} else {
  run('npx prisma migrate deploy', { cwd: 'server', env: { DATABASE_URL: direct } });
  run('node dist/scripts/import-reference-data.js', { cwd: 'server', env: { DATABASE_URL: direct } });
}

if (!process.env.DATA_ENCRYPTION_KEY) {
  console.warn('\n⚠ DATA_ENCRYPTION_KEY is not set. The API will refuse to start until it is added (see docs/VERCEL.md).\n');
}
