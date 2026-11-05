import { z } from 'zod';
import { isValidIsoDate } from './time.js';

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

/** Query filter restricted to known enum values (single value or comma-separated list); unknown values -> 400. */
export const enumFilter = (allowed: readonly string[], multi = false) =>
  z
    .string()
    .trim()
    .default('')
    .refine((v) => v === '' || (multi ? v.split(',') : [v]).every((x) => allowed.includes(x)), { message: `Unknown filter value. Allowed: ${allowed.join(', ')}` });

/** Optional YYYY-MM-DD query date that must be a real calendar date (2026-13-45 -> 400, not 500). */
export const isoDateParam = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => isValidIsoDate(v), { message: 'Not a valid calendar date' })
  .optional();
