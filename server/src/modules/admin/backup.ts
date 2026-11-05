import { spawn } from 'node:child_process';
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { createWriteStream, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform, Writable } from 'node:stream';
import { prisma } from '../../db.js';
import { config } from '../../config.js';

/**
 * Encrypted logical backup: pg_dump (custom format) -> AES-256-GCM -> file.
 * File layout: "IGBK1" | 12-byte IV | ciphertext | 16-byte auth tag.
 * Restore is a deliberate CLI-only operation (scripts/restore.ts) — never from the web UI.
 */
export async function runBackup(triggeredById: string | null) {
  if (!config.BACKUP_ENCRYPTION_KEY) throw new Error('BACKUP_ENCRYPTION_KEY is not configured; unencrypted backups are not allowed');
  const key = Buffer.from(config.BACKUP_ENCRYPTION_KEY, 'base64');
  if (key.length !== 32) throw new Error('BACKUP_ENCRYPTION_KEY must be 32 bytes (base64)');
  const dir = resolve(config.BACKUP_DIR);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `invoicego-${stamp}.dump.enc`;
  const rec = await prisma.backupRecord.create({ data: { status: 'RUNNING', fileName, triggeredById } });
  try {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const hash = createHash('sha256');
    let size = 0;
    const out = createWriteStream(join(dir, fileName), { mode: 0o600 });
    out.write(Buffer.concat([Buffer.from('IGBK1'), iv]));
    const dump = spawn(config.PG_DUMP_PATH, ['--format=custom', '--no-owner', '--dbname', config.DATABASE_URL], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    dump.stderr.on('data', (d) => (stderr += d.toString()));
    const exit = new Promise<number>((res) => dump.on('close', (c) => res(c ?? 1)));
    const counter = new Transform({
      transform(chunk, _e, cb) {
        size += chunk.length;
        hash.update(chunk);
        cb(null, chunk);
      },
    });
    const sink = new Writable({
      write(chunk, _e, cb) {
        if (out.write(chunk)) cb();
        else out.once('drain', cb);
      },
    });
    await pipeline(dump.stdout, counter, cipher, sink);
    out.end(cipher.getAuthTag());
    await new Promise<void>((r) => out.on('close', () => r()));
    const code = await exit;
    if (code !== 0) throw new Error(`pg_dump exited with ${code}: ${stderr.slice(0, 500)}`);
    await prisma.backupRecord.update({ where: { id: rec.id }, data: { status: 'SUCCEEDED', sizeBytes: BigInt(size), sha256: hash.digest('hex'), finishedAt: new Date() } });
    return { fileName, size };
  } catch (e) {
    await prisma.backupRecord.update({ where: { id: rec.id }, data: { status: 'FAILED', error: String((e as Error).message).slice(0, 1000), finishedAt: new Date() } });
    throw e;
  }
}
