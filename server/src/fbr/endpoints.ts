import { config, isProd } from '../config.js';

export type Env = 'SANDBOX' | 'PRODUCTION';

/** Spec v1.12 §4.1.1, §4.1.2, §4.2.1, §4.2.2 (see SOURCE_CONFLICTS A1). */
export const DEFAULT_URLS: Record<Env, { postUrl: string; validateUrl: string }> = {
  SANDBOX: {
    postUrl: 'https://gw.fbr.gov.pk/di_data/v1/di/postinvoicedata_sb',
    validateUrl: 'https://gw.fbr.gov.pk/di_data/v1/di/validateinvoicedata_sb',
  },
  PRODUCTION: {
    postUrl: 'https://gw.fbr.gov.pk/di_data/v1/di/postinvoicedata',
    validateUrl: 'https://gw.fbr.gov.pk/di_data/v1/di/validateinvoicedata',
  },
};

const INVOICE_PATHS: Record<Env, { post: string; validate: string }> = {
  SANDBOX: { post: '/di_data/v1/di/postinvoicedata_sb', validate: '/di_data/v1/di/validateinvoicedata_sb' },
  PRODUCTION: { post: '/di_data/v1/di/postinvoicedata', validate: '/di_data/v1/di/validateinvoicedata' },
};

/** Spec v1.12 §5 reference endpoints (paths only; host comes from the allow-list). */
export const REFERENCE_PATHS = {
  provinces: '/pdi/v1/provinces',
  doctypecode: '/pdi/v1/doctypecode',
  itemdesccode: '/pdi/v1/itemdesccode',
  sroitemcode: '/pdi/v1/sroitemcode',
  transtypecode: '/pdi/v1/transtypecode',
  uom: '/pdi/v1/uom',
  SroSchedule: '/pdi/v1/SroSchedule',
  SaleTypeToRate: '/pdi/v2/SaleTypeToRate',
  HS_UOM: '/pdi/v2/HS_UOM',
  SROItem: '/pdi/v2/SROItem',
  statl: '/dist/v1/statl',
  Get_Reg_Type: '/dist/v1/Get_Reg_Type',
} as const;
export type ReferenceName = keyof typeof REFERENCE_PATHS;

export function allowedOrigins(): string[] {
  const list = config.FBR_ALLOWED_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean);
  if (!isProd && config.FBR_ALLOW_TEST_ORIGINS) {
    list.push(...config.FBR_ALLOW_TEST_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean));
  }
  return list;
}

export function referenceBase(): string {
  const origin = new URL(config.FBR_REFERENCE_BASE_URL).origin;
  if (!allowedOrigins().includes(origin)) throw new EndpointError('FBR_REFERENCE_BASE_URL is not an allowed origin');
  return origin;
}

export class EndpointError extends Error {}

/**
 * SSRF guard: a configured URL must be on an approved origin, use the exact documented
 * path for its environment and operation, and carry no credentials, query or fragment.
 * Sandbox URLs must be the "_sb" variants; production URLs must not be.
 */
export function validateInvoiceUrl(raw: string, env: Env, op: 'post' | 'validate'): string {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new EndpointError('Not a valid URL');
  }
  const origins = allowedOrigins();
  if (!origins.includes(u.origin)) throw new EndpointError(`Host not allowed. Allowed: ${config.FBR_ALLOWED_ORIGINS}`);
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && !isProd && config.FBR_ALLOW_TEST_ORIGINS?.includes(u.origin))) {
    throw new EndpointError('Only HTTPS FBR endpoints are allowed');
  }
  if (u.username || u.password) throw new EndpointError('Credentials in URL are not allowed');
  if (u.search || u.hash) throw new EndpointError('Query strings and fragments are not allowed');
  const expected = INVOICE_PATHS[env][op];
  if (u.pathname !== expected) {
    throw new EndpointError(`${env === 'SANDBOX' ? 'Sandbox' : 'Production'} ${op} URL must use the documented path ${expected}`);
  }
  return u.origin + u.pathname;
}

export function referenceUrl(name: ReferenceName, query?: Record<string, string>): string {
  const u = new URL(REFERENCE_PATHS[name], referenceBase());
  if (query) for (const [k, v] of Object.entries(query)) u.searchParams.set(k, v);
  if (!allowedOrigins().includes(u.origin)) throw new EndpointError('Reference host not allowed');
  return u.toString();
}
