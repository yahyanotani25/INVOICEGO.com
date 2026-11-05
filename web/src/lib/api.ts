/**
 * API client. The CSRF token lives in memory only (never localStorage); session cookies are
 * HttpOnly. User and admin areas use separate sessions and separate CSRF tokens.
 */
export interface Issue {
  field: string;
  line?: number;
  level: 'error' | 'warning';
  message: string;
  code?: string;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: { issues?: Issue[]; [k: string]: unknown },
  ) {
    super(message);
  }
  get issues(): Issue[] {
    return this.details?.issues ?? [];
  }
}

const tokens: Record<'app' | 'admin', string | null> = { app: null, admin: null };
export function setCsrf(area: 'app' | 'admin', t: string | null) {
  tokens[area] = t;
}

type Opts = { method?: string; body?: unknown; area?: 'app' | 'admin'; form?: FormData; raw?: boolean };

export async function api<T = unknown>(path: string, opts: Opts = {}): Promise<T> {
  const area = opts.area ?? (path.startsWith('/api/admin') ? 'admin' : 'app');
  const method = opts.method ?? (opts.body !== undefined || opts.form ? 'POST' : 'GET');
  const headers: Record<string, string> = { 'x-requested-with': 'InvoiceGO' };
  if (method !== 'GET' && tokens[area]) headers['x-csrf-token'] = tokens[area]!;
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  const res = await fetch(path, { method, headers, body, credentials: 'same-origin' });
  if (opts.raw && res.ok) return res as unknown as T;
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const e = json?.error;
    throw new ApiError(res.status, e?.code ?? 'HTTP_' + res.status, e?.message ?? `Request failed (${res.status})`, e?.details);
  }
  return json as T;
}

/** Download a file from an authenticated endpoint. */
export async function download(path: string, fallbackName: string) {
  const res = await fetch(path, { credentials: 'same-origin', headers: { 'x-requested-with': 'InvoiceGO' } });
  if (!res.ok) {
    let msg = `Download failed (${res.status})`;
    try {
      msg = (await res.json()).error.message;
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, 'DOWNLOAD', msg);
  }
  const blob = await res.blob();
  const cd = res.headers.get('content-disposition') ?? '';
  const name = /filename="([^"]+)"/.exec(cd)?.[1] ?? fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const qs = (o: Record<string, string | number | undefined | null>) =>
  '?' + new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => [k, String(v)])).toString();
