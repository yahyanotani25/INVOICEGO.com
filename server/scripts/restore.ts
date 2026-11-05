/**
 * Restore an encrypted backup into a TARGET database (deliberately CLI-only):
 *   tsx scripts/restore.ts --file backups/invoicego-....dump.enc --target-url postgresql://... --confirm
 * Decrypts with BACKUP_ENCRYPTION_KEY, verifies the GCM tag, then runs pg_restore --clean.
 * Always restore into a fresh database first and verify before switching traffic.
 */
import { createDecipheriv } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';

function arg(n: string) {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const file = arg('file');
const target = arg('target-url');
if (!file || !target || !process.argv.includes('--confirm')) {
  console.error('Usage: --file <backup.dump.enc> --target-url <postgres url> --confirm');
  process.exit(1);
}
const keyB64 = process.env.BACKUP_ENCRYPTION_KEY;
if (!keyB64) throw new Error('BACKUP_ENCRYPTION_KEY is required');
const key = Buffer.from(keyB64, 'base64');
const buf = readFileSync(file!);
if (buf.subarray(0, 5).toString() !== 'IGBK1') throw new Error('Not an InvoiceGO backup file');
const iv = buf.subarray(5, 17);
const tag = buf.subarray(buf.length - 16);
const d = createDecipheriv('aes-256-gcm', key, iv);
d.setAuthTag(tag);
const plain = Buffer.concat([d.update(buf.subarray(17, buf.length - 16)), d.final()]); // throws if tampered
const p = spawn(process.env.PG_RESTORE_PATH ?? 'pg_restore', ['--clean', '--if-exists', '--no-owner', '--dbname', target!], { stdio: ['pipe', 'inherit', 'inherit'] });
p.stdin.end(plain);
p.on('close', (c) => {
  console.log(c === 0 ? 'Restore completed.' : `pg_restore exited with ${c}`);
  process.exit(c ?? 1);
});
