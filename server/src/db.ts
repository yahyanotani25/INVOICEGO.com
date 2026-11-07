import { PrismaClient } from '@prisma/client';
import { resolveDatabaseUrl } from './lib/dbUrl.js';

const url = resolveDatabaseUrl();

export const prisma = new PrismaClient({
  ...(url ? { datasources: { db: { url } } } : {}),
  log: [{ emit: 'event', level: 'warn' }, { emit: 'event', level: 'error' }],
});
