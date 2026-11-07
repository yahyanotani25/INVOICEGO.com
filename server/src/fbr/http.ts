import { EnvHttpProxyAgent, ProxyAgent, request, type Dispatcher } from 'undici';
import { config } from '../config.js';

/**
 * Low-level HTTP to FBR. Distinguishes:
 *  - NOT_SENT  : failure before the request could reach FBR (DNS, connect refused/timeout, TLS)
 *                -> safe to retry; FBR cannot have recorded it.
 *  - UNCERTAIN : the request may have been delivered but no complete response arrived
 *                (response timeout, connection reset) -> never resubmit blindly.
 */
let dispatcher: Dispatcher | null = null;
/**
 * FBR_PROXY_URL (if set) sends ALL FBR traffic through a proxy with a static egress IP, which
 * is what businesses whitelist in IRIS. Needed on hosts without fixed outbound IPs (e.g. Vercel
 * Hobby). Otherwise standard HTTP(S)_PROXY/NO_PROXY variables are honoured.
 */
function agent(): Dispatcher {
  if (!dispatcher) {
    const timeouts = { headersTimeout: config.FBR_HTTP_RESPONSE_TIMEOUT_MS, bodyTimeout: config.FBR_HTTP_RESPONSE_TIMEOUT_MS };
    dispatcher = config.FBR_PROXY_URL
      ? new ProxyAgent({
          uri: config.FBR_PROXY_URL,
          proxyTls: { timeout: config.FBR_HTTP_CONNECT_TIMEOUT_MS },
          requestTls: { timeout: config.FBR_HTTP_CONNECT_TIMEOUT_MS },
          ...timeouts,
        })
      : new EnvHttpProxyAgent({ connect: { timeout: config.FBR_HTTP_CONNECT_TIMEOUT_MS }, ...timeouts });
  }
  return dispatcher;
}

export function usingFbrProxy() {
  return !!config.FBR_PROXY_URL;
}

export interface HttpResult {
  delivery: 'RESPONSE' | 'NOT_SENT' | 'UNCERTAIN';
  status?: number;
  body?: string;
  errorCode?: string;
  errorMessage?: string;
  durationMs: number;
}

const NOT_SENT_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'UND_ERR_CONNECT_TIMEOUT',
  'CERT_HAS_EXPIRED',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'UND_ERR_INVALID_ARG',
]);

const MAX_BODY = 256 * 1024;

export async function fbrHttp(opts: { method: 'GET' | 'POST'; url: string; token: string; body?: string }): Promise<HttpResult> {
  const started = Date.now();
  try {
    const res = await request(opts.url, {
      method: opts.method,
      dispatcher: agent(),
      headers: {
        authorization: `Bearer ${opts.token}`,
        accept: 'application/json',
        ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: opts.body,
    });
    let text = '';
    for await (const chunk of res.body) {
      if (text.length < MAX_BODY) text += chunk.toString('utf8');
    }
    return { delivery: 'RESPONSE', status: res.statusCode, body: text.slice(0, MAX_BODY), durationMs: Date.now() - started };
  } catch (err: any) {
    const code: string = err?.code ?? err?.cause?.code ?? err?.name ?? 'UNKNOWN';
    const msg = String(err?.message ?? '');
    // A failed proxy CONNECT tunnel (e.g. 407/502 from the proxy) never reaches FBR.
    const tunnelFailed = /Proxy response|tunnel/i.test(msg) && !/socket hang up/i.test(msg);
    const delivery = NOT_SENT_CODES.has(code) || tunnelFailed ? 'NOT_SENT' : 'UNCERTAIN';
    return { delivery, errorCode: code, errorMessage: String(err?.message ?? err), durationMs: Date.now() - started };
  }
}

/** Plain GET without credentials (used only for public egress-IP detection in the admin panel). */
export async function publicGetJson(url: string): Promise<unknown> {
  const res = await request(url, { method: 'GET', dispatcher: agent(), headers: { accept: 'application/json' } });
  const text = await res.body.text();
  return JSON.parse(text);
}
