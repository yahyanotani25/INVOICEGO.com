/**
 * Resolves database URLs from the variable names used by common hosts, without depending on
 * the rest of the configuration (scripts such as the reference import use this too).
 *
 *  runtime (pooled):  DATABASE_URL | POSTGRES_PRISMA_URL | POSTGRES_URL
 *  direct (migrations): DATABASE_URL_UNPOOLED | POSTGRES_URL_NON_POOLING | DIRECT_URL | runtime URL
 *
 * Neon's pooled endpoint (host contains "-pooler") runs PgBouncer in transaction mode, so
 * Prisma needs pgbouncer=true there (no prepared-statement reuse across transactions).
 */
export function resolveDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const raw = env.DATABASE_URL || env.POSTGRES_PRISMA_URL || env.POSTGRES_URL;
  if (!raw) return undefined;
  return withPoolerParams(raw);
}

export function resolveDirectUrl(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env.DATABASE_URL_UNPOOLED || env.POSTGRES_URL_NON_POOLING || env.DIRECT_URL || env.DATABASE_URL || env.POSTGRES_URL;
}

export function withPoolerParams(raw: string): string {
  try {
    const u = new URL(raw);
    const pooled = /-pooler\./.test(u.hostname) || u.port === '6543';
    if (pooled && !u.searchParams.has('pgbouncer')) u.searchParams.set('pgbouncer', 'true');
    if (!u.searchParams.has('connect_timeout')) u.searchParams.set('connect_timeout', '15');
    return u.toString();
  } catch {
    return raw;
  }
}
