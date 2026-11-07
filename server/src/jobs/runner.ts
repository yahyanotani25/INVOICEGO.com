import { hostname } from 'node:os';
import type { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { config } from '../config.js';
import { sweepStaleLocks } from '../modules/invoices/service.js';

/**
 * Background jobs, resumable in time slices so they work both with a long-running worker
 * (VM/container) and on serverless hosts (Vercel), where a request may run for a limited time.
 *
 * A handler receives a deadline. It processes items one by one, records progress after each,
 * and returns 'PARTIAL' when the deadline is near; the job is then re-queued and the next
 * slice continues where it stopped. Handlers must be idempotent per item (bulk submit never
 * re-submits accepted invoices and never retries uncertain ones).
 */
export interface JobCtx {
  id: string;
  businessId: string | null;
  payload: Prisma.JsonValue;
  progress: Prisma.JsonValue;
  createdById: string | null;
  deadline: number;
}
export type JobHandler = (job: JobCtx, progress: (p: Record<string, unknown>) => Promise<void>) => Promise<void | 'DONE' | 'PARTIAL'>;

const handlers = new Map<string, JobHandler>();
export function registerJob(type: string, h: JobHandler) {
  handlers.set(type, h);
}

export async function enqueue(type: string, payload: Prisma.InputJsonValue, opts: { businessId?: string | null; createdById?: string | null } = {}) {
  return prisma.job.create({ data: { type, payload, businessId: opts.businessId ?? null, createdById: opts.createdById ?? null } });
}

const WORKER = `${hostname()}:${process.pid}`;

/** Claim one job atomically (safe with multiple app instances). Optionally restricted to one job id. */
async function claim(jobId?: string) {
  const rows = jobId
    ? await prisma.$queryRaw<{ id: string }[]>`
        UPDATE "Job" SET status = 'RUNNING', "lockedBy" = ${WORKER}, "startedAt" = now(), attempts = attempts + 1
        WHERE id = (SELECT id FROM "Job" WHERE id = ${jobId} AND status = 'QUEUED' FOR UPDATE SKIP LOCKED) RETURNING id`
    : await prisma.$queryRaw<{ id: string }[]>`
        UPDATE "Job" SET status = 'RUNNING', "lockedBy" = ${WORKER}, "startedAt" = now(), attempts = attempts + 1
        WHERE id = (
          SELECT id FROM "Job" WHERE status = 'QUEUED' AND "runAt" <= now()
          ORDER BY "createdAt" ASC FOR UPDATE SKIP LOCKED LIMIT 1
        ) RETURNING id`;
  return rows[0] ? prisma.job.findUnique({ where: { id: rows[0].id } }) : null;
}

export type RunResult = { ran: false } | { ran: true; id: string; status: 'SUCCEEDED' | 'FAILED' | 'QUEUED' };

/** Run one queued job (or the given job) for at most budgetMs. */
export async function runOnce(budgetMs = 10 * 60_000, jobId?: string): Promise<RunResult> {
  const job = await claim(jobId);
  if (!job) return { ran: false };
  const h = handlers.get(job.type);
  try {
    if (!h) throw new Error(`No handler for job type ${job.type}`);
    const r = await h({ ...job, deadline: Date.now() + budgetMs }, async (p) => {
      await prisma.job.update({ where: { id: job.id }, data: { progress: p as Prisma.InputJsonValue } });
    });
    if (r === 'PARTIAL') {
      await prisma.job.update({ where: { id: job.id }, data: { status: 'QUEUED', lockedBy: null } });
      return { ran: true, id: job.id, status: 'QUEUED' };
    }
    await prisma.job.update({ where: { id: job.id }, data: { status: 'SUCCEEDED', finishedAt: new Date() } });
    return { ran: true, id: job.id, status: 'SUCCEEDED' };
  } catch (e) {
    await prisma.job.update({ where: { id: job.id }, data: { status: 'FAILED', finishedAt: new Date(), lastError: String((e as Error).message).slice(0, 1000) } });
    return { ran: true, id: job.id, status: 'FAILED' };
  }
}

/**
 * Jobs left RUNNING by a vanished worker (crash, serverless timeout) are re-queued. This is safe
 * because handlers are resumable and idempotent per item; an invoice that was mid-submission is
 * caught by the stale-lock sweeper and goes to reconciliation, never to a blind resend.
 */
export async function recoverOrphans() {
  await prisma.job.updateMany({
    where: { status: 'RUNNING', startedAt: { lt: new Date(Date.now() - config.JOB_ORPHAN_MINUTES * 60_000) } },
    data: { status: 'QUEUED', lockedBy: null, lastError: 'Worker stopped while the job was running; resumed' },
  });
}

let lastMaintenance = 0;
/** Cheap periodic maintenance, safe to call from any request (at most once a minute per instance). */
export async function maintenance(force = false) {
  if (!force && Date.now() - lastMaintenance < 60_000) return;
  lastMaintenance = Date.now();
  await sweepStaleLocks();
  await recoverOrphans();
}

export function startWorker(log: { error: (o: object, m: string) => void }) {
  let stopped = false;
  const loop = async () => {
    while (!stopped) {
      try {
        await maintenance();
        const r = await runOnce();
        if (!r.ran) await new Promise((res) => setTimeout(res, 1000));
      } catch (e) {
        log.error({ err: e }, 'job worker error');
        await new Promise((res) => setTimeout(res, 5000));
      }
    }
  };
  void loop();
  return () => {
    stopped = true;
  };
}
