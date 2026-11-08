import { prisma } from '../../db.js';
import { registerJob } from '../../jobs/runner.js';
import { emailRecipients } from './notify.js';

/**
 * Announcement emails to all active business users, in resumable batches (works on serverless:
 * each slice stops before its deadline and the next slice continues from the stored cursor).
 */
export function registerMailJobs() {
  registerJob('mail.announcement', async (job, progress) => {
    const p = job.payload as { title: string; body: string };
    const prev = (job.progress ?? {}) as { cursor?: string; sent?: number; recipients?: number };
    let cursor = prev.cursor;
    let sent = prev.sent ?? 0;
    let recipients = prev.recipients ?? 0;
    for (;;) {
      if (Date.now() > job.deadline - 15_000) return 'PARTIAL';
      const batch = await prisma.user.findMany({
        where: { platformRole: 'NONE', status: 'ACTIVE', deletedAt: null, emailNotifications: true, ...(cursor ? { id: { gt: cursor } } : {}) },
        orderBy: { id: 'asc' },
        take: 25,
        select: { id: true, email: true, name: true },
      });
      if (batch.length === 0) return 'DONE';
      sent += await emailRecipients(batch, p.title, p.body, '/app/notifications', 'app');
      recipients += batch.length;
      cursor = batch[batch.length - 1].id;
      await progress({ cursor, sent, recipients });
    }
  });
}
