import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient({
  log: [{ emit: 'event', level: 'warn' }, { emit: 'event', level: 'error' }],
});
