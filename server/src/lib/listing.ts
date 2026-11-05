import { z } from 'zod';

export const listQuery = z.object({
  q: z.string().trim().max(200).optional().default(''),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.string().trim().max(50).optional(),
  dir: z.enum(['asc', 'desc']).optional().default('desc'),
});

export function paging(page: number, pageSize: number) {
  return { skip: (page - 1) * pageSize, take: pageSize };
}

export function sortBy<T extends string>(allowed: readonly T[], sort: string | undefined, dir: 'asc' | 'desc', fallback: T) {
  const key = (allowed as readonly string[]).includes(sort ?? '') ? (sort as T) : fallback;
  return { [key]: dir } as Record<T, 'asc' | 'desc'>;
}
