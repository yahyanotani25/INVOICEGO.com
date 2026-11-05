/** CLI backup (same encrypted format as the admin-panel backup). Schedule with cron/systemd. */
import { prisma } from '../src/db.js';
import { runBackup } from '../src/modules/admin/backup.js';

runBackup(null)
  .then(async (r) => {
    console.log(`Backup written: ${r.fileName} (${r.size} bytes before encryption)`);
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(String(e?.message ?? e));
    await prisma.$disconnect();
    process.exit(1);
  });
