import { api, ApiError } from '@/lib/api';

/**
 * Admin API wrapper: identical to api(), but a 401 (session expired / MFA required)
 * triggers the registered handler so the admin shell can return to the sign-in screen.
 */
let onUnauthorized: (() => void) | null = null;
export function setAdminUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn;
}

export async function aapi<T = unknown>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  try {
    return await api<T>(`/api/admin${path}`, { ...opts, area: 'admin' });
  } catch (e) {
    if (e instanceof ApiError && e.status === 401 && !path.startsWith('/auth/')) onUnauthorized?.();
    throw e;
  }
}

export interface AuditRow {
  id: string;
  actorUserId: string | null;
  actorKind: string;
  businessId: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  metadata: unknown;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
}

export interface ExplainedIssue {
  scope: string;
  itemSNo?: string;
  code?: string | null;
  message: string;
  known: boolean;
  category?: string;
  fbrMessage?: string;
  fbrDescription?: string;
  field?: string;
  fieldLabel?: string;
  action?: string;
}

export const USER_STATUS_TONE: Record<string, 'green' | 'red' | 'amber' | 'gray' | 'blue'> = {
  ACTIVE: 'green',
  INACTIVE: 'gray',
  SUSPENDED: 'amber',
  BLOCKED: 'red',
  PENDING_VERIFICATION: 'blue',
  DELETED: 'gray',
};

export const TICKET_TONE: Record<string, 'green' | 'red' | 'amber' | 'gray' | 'blue'> = {
  OPEN: 'blue',
  IN_PROGRESS: 'amber',
  AWAITING_USER: 'gray',
  RESOLVED: 'green',
  CLOSED: 'gray',
};

export const human = (s: string | null | undefined) => (s ? s.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) : '—');

export function prettyJson(text: string | null | undefined) {
  if (!text) return '';
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}
