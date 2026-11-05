import { hostname } from 'node:os';
import type { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { sweepStaleLocks } from '../modules/invoices/service.js';

export type JobHandler = (job: { id: string; businessId: string | null; payload: Prisma.JsonValue; createdById: string | null }, progress: (p: Record<string, unknown>) => Promise<void>) => Promise<void>;

const handlers = new Map<string, JobHandler>();
export function registerJob(type: string, h: JobHandler) {
  handlers.set(type, h);
}

export async function enqueue(type: string, payload: Prisma.InputJsonValue, opts: { businessId?: string | null; createdById?: string | null } = {}) {
  return prisma.job.create({ data: { type, payload, businessId: opts.businessId ?? null, createdById: opts.createdById ?? null } });
}

const WORKER = `${hostname()}:${process.pid}`;

/** Claim one job atomically (safe with multiple app instances). */
async function claim() {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    UPDATE "Job" SET status = 'RUNNING', "lockedBy" = ${WORKER}, "startedAt" = now(), attempts = attempts + 1
    WHERE id = (
      SELECT id FROM "Job" WHERE status = 'QUEUED' AND "runAt" <= now()
      ORDER BY "createdAt" ASC FOR UPDATE SKIP LOCKED LIMIT 1
    ) RETURNING id`;
  return rows[0] ? prisma.job.findUnique({ where: { id: rows[0].id } }) : null;
}

export async function runOnce(): Promise<boolean> {
  const job = await claim();
  if (!job) return false;
  const h = handlers.get(job.type);
  try {
    if (!h) throw new Error(`No handler for job type ${job.type}`);
    await h(job, async (p) => {
      await prisma.job.update({ where: { id: job.id }, data: { progress: p as Prisma.InputJsonValue } });
    });
    await prisma.job.update({ where: { id: job.id }, data: { status: 'SUCCEEDED', finishedAt: new Date() } });
  } catch (e) {
    await prisma.job.update({ where: { id: job.id }, data: { status: 'FAILED', finishedAt: new Date(), lastError: String((e as Error).message).slice(0, 1000) } });
  }
  return true;
}

/** Jobs left RUNNING by a crashed process are marked FAILED (never silently re-run: bulk submit must not resubmit). */
async function recoverOrphans() {
  await prisma.job.updateMany({
    where: { status: 'RUNNING', startedAt: { lt: new Date(Date.now() - 30 * 60_000) } },
    data: { status: 'FAILED', lastError: 'Worker stopped while the job was running', finishedAt: new Date() },
  });
}

export function startWorker(log: { error: (o: object, m: string) => void }) {
  let stopped = false;
  let lastSweep = 0;
  const loop = async () => {
    while (!stopped) {
      try {
        if (Date.now() - lastSweep > 60_000) {
          lastSweep = Date.now();
          await sweepStaleLocks();
          await recoverOrphans();
        }
        const did = await runOnce();
        if (!did) await new Promise((r) => setTimeout(r, 1000));
      } catch (e) {
        log.error({ err: e }, 'job worker error');
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  };
  void loop();
  return () => {
    stopped = true;
  };
}
