/** Display helpers. Business dates are calendar dates (Asia/Karachi); timestamps are UTC and shown in PKT. */
export const TZ = 'Asia/Karachi';

export function pkr(v: string | number | null | undefined, opts: { symbol?: boolean; dp?: number } = {}) {
  if (v === null || v === undefined || v === '') return '—';
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return String(v);
  const s = n.toLocaleString('en-PK', { minimumFractionDigits: opts.dp ?? 2, maximumFractionDigits: opts.dp ?? 2 });
  return opts.symbol === false ? s : `Rs ${s}`;
}

export function qty(v: string | number | null | undefined) {
  if (v === null || v === undefined || v === '') return '—';
  return Number(v).toLocaleString('en-PK', { maximumFractionDigits: 4 });
}

const dtf = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const df = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric' });

/** UTC timestamp -> "06 Nov 2026, 01:59 PKT" */
export function dateTime(v: string | Date | null | undefined) {
  if (!v) return '—';
  return `${dtf.format(new Date(v))} PKT`;
}
/** Calendar date "YYYY-MM-DD" -> "06 Nov 2026" (no timezone shift) */
export function dateOnly(v: string | null | undefined) {
  if (!v) return '—';
  return df.format(new Date(`${v.slice(0, 10)}T00:00:00Z`));
}

export const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Draft',
  VALIDATING: 'Validating',
  VALIDATED: 'Validated',
  VALIDATION_FAILED: 'Validation failed',
  SUBMITTING: 'Submitting',
  ACCEPTED: 'Accepted by FBR',
  REJECTED: 'Rejected by FBR',
  RECONCILIATION_REQUIRED: 'Reconciliation required',
};
export const STATUS_TONE: Record<string, Tone> = {
  DRAFT: 'gray',
  VALIDATING: 'blue',
  VALIDATED: 'blue',
  VALIDATION_FAILED: 'red',
  SUBMITTING: 'blue',
  ACCEPTED: 'green',
  REJECTED: 'red',
  RECONCILIATION_REQUIRED: 'amber',
};
export type Tone = 'gray' | 'green' | 'red' | 'amber' | 'blue' | 'violet';

export const OUTCOME_TONE: Record<string, Tone> = { VALID: 'green', OK: 'green', INVALID: 'red', AUTH_ERROR: 'red', HTTP_ERROR: 'red', NOT_SENT: 'amber', UNCERTAIN: 'amber', BAD_RESPONSE: 'amber', PENDING: 'gray' };

export const regLabel = (r: string | null | undefined) => (r === 'REGISTERED' ? 'Registered' : r === 'UNREGISTERED' ? 'Unregistered' : '—');
export const typeLabel = (t: string) => (t === 'DEBIT_NOTE' ? 'Debit Note' : 'Sale Invoice');
