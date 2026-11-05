import { buildApp } from './app.js';
import { config } from './config.js';
import { prisma } from './db.js';
import { startWorker } from './jobs/runner.js';
import { registerBulkJobs } from './modules/bulk/service.js';
import { mailConfigured } from './lib/mailer.js';

registerBulkJobs();

const app = await buildApp();
if (config.NODE_ENV === 'production' && !mailConfigured()) {
  app.log.warn('SMTP is not configured: verification and password-reset emails cannot be sent');
}
const stopWorker = config.JOB_WORKER_ENABLED ? startWorker(app.log) : () => {};

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  stopWorker();
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ port: config.PORT, host: config.HOST });
