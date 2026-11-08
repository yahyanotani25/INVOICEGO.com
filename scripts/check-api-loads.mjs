/**
 * Build-time guard: loads the compiled API module graph the way the Vercel function runtime does
 * (require() of ES modules disabled) and fails the build if any dependency cannot be loaded.
 * Without this, such a failure only shows up after deployment as "The server could not start".
 *
 * Run with: node --no-experimental-require-module scripts/check-api-loads.mjs
 * Placeholder settings are used so that configuration checks pass; nothing connects to a database.
 */
Object.assign(process.env, {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://check:check@127.0.0.1:1/check',
  DATA_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
  COOKIE_SECURE: 'true',
  JOB_WORKER_ENABLED: 'false',
  APP_BASE_URL: 'https://example.invalid',
});
delete process.env.ADMIN_BOOTSTRAP_TOKEN;

const target = new URL('../server/dist/src/app.js', import.meta.url);
try {
  const mod = await import(target.href);
  if (typeof mod.buildApp !== 'function') throw new Error('server/dist/src/app.js does not export buildApp');
  const app = await mod.buildApp();
  await app.ready();
  await app.close();
  console.log('✓ API module graph loads under the function runtime rules');
  process.exit(0);
} catch (err) {
  console.error('\n✖ The API cannot start under the function runtime rules:\n');
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
}
