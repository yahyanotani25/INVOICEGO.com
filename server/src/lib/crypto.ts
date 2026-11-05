import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';

const VERSION = 'v1';

function keys(): Buffer[] {
  const k = [Buffer.from(config.DATA_ENCRYPTION_KEY, 'base64')];
  if (config.DATA_ENCRYPTION_KEY_PREVIOUS) k.push(Buffer.from(config.DATA_ENCRYPTION_KEY_PREVIOUS, 'base64'));
  return k;
}

/** AES-256-GCM. Output: v1:<iv b64>:<tag b64>:<ciphertext b64> */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keys()[0], iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join(':');
}

export function decryptSecret(enc: string): string {
  const [v, ivB, tagB, ctB] = enc.split(':');
  if (v !== VERSION || !ivB || !tagB || ctB === undefined) throw new Error('Unsupported secret format');
  let lastErr: unknown;
  for (const key of keys()) {
    try {
      const d = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB, 'base64'));
      d.setAuthTag(Buffer.from(tagB, 'base64'));
      return Buffer.concat([d.update(Buffer.from(ctB, 'base64')), d.final()]).toString('utf8');
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error('Unable to decrypt secret: ' + String((lastErr as Error)?.message ?? lastErr));
}

export function sha256Hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Masks a secret for display: only the last 4 characters are ever revealed. */
export function maskLast4(last4: string | null | undefined): string | null {
  return last4 ? `••••••••${last4}` : null;
}
