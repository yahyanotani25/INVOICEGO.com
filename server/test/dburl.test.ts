import { describe, expect, it } from 'vitest';
import { resolveDatabaseUrl, resolveDirectUrl, withPoolerParams } from '../src/lib/dbUrl';

describe('database URL resolution for hosted Postgres', () => {
  it('adds pgbouncer=true for Neon pooled endpoints, not for direct ones', () => {
    const pooled = withPoolerParams('postgresql://u:p@ep-cool-123-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require');
    expect(new URL(pooled).searchParams.get('pgbouncer')).toBe('true');
    expect(new URL(pooled).searchParams.get('sslmode')).toBe('require');
    const direct = withPoolerParams('postgresql://u:p@ep-cool-123.us-east-2.aws.neon.tech/neondb?sslmode=require');
    expect(new URL(direct).searchParams.has('pgbouncer')).toBe(false);
  });
  it('accepts the variable names used by Neon / Vercel integrations', () => {
    expect(resolveDatabaseUrl({ POSTGRES_PRISMA_URL: 'postgresql://a@h/db' } as NodeJS.ProcessEnv)).toMatch(/^postgresql:\/\/a@h\/db/);
    expect(resolveDirectUrl({ DATABASE_URL: 'postgresql://pooled@h/db', DATABASE_URL_UNPOOLED: 'postgresql://direct@h/db' } as NodeJS.ProcessEnv)).toBe('postgresql://direct@h/db');
    expect(resolveDirectUrl({ POSTGRES_URL_NON_POOLING: 'postgresql://d@h/db', POSTGRES_URL: 'postgresql://p@h/db' } as NodeJS.ProcessEnv)).toBe('postgresql://d@h/db');
    expect(resolveDatabaseUrl({} as NodeJS.ProcessEnv)).toBeUndefined();
  });
});
