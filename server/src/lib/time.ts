/**
 * Business-date rules use trusted server time in Asia/Karachi.
 * Timestamps are stored in UTC; only calendar dates are evaluated in PKT.
 */
export const BUSINESS_TZ = 'Asia/Karachi';

/** Exact client-mandated message (DETAILS.docx / client brief). Do not reword. */
export const MONTH_RULE_MESSAGE = "You can't create future or previous month invoices";

export interface KarachiNow {
  date: string; // YYYY-MM-DD
  time: string; // HH:mm
  year: number;
  month: number; // 1-12
  monthStart: string;
  monthEnd: string;
}

const fmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

let clockOverride: (() => Date) | null = null;
/** Test hook: replace the trusted clock. Never exposed through an API. */
export function __setClock(fn: (() => Date) | null) {
  clockOverride = fn;
}
export function serverNow(): Date {
  return clockOverride ? clockOverride() : new Date();
}

export function karachiParts(d: Date): KarachiNow {
  const parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
  const year = Number(parts.year);
  const month = Number(parts.month);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const mm = String(month).padStart(2, '0');
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
    year,
    month,
    monthStart: `${year}-${mm}-01`,
    monthEnd: `${year}-${mm}-${String(lastDay).padStart(2, '0')}`,
  };
}

export function karachiNow(): KarachiNow {
  return karachiParts(serverNow());
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Strict YYYY-MM-DD calendar date validation (rejects 2026-02-30 etc.). */
export function isValidIsoDate(s: string): boolean {
  const m = ISO_DATE.exec(s);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, mo, 0)).getUTCDate();
}

export type MonthRuleResult = { ok: true } | { ok: false; message: string; reason: 'INVALID_DATE' | 'OUTSIDE_CURRENT_MONTH' };

/**
 * Client rule: invoices may be created/submitted only for the present calendar month
 * (Asia/Karachi). This is a calendar-month rule, NOT a rolling 30-day window, and it does
 * not separately forbid later days of the current month.
 */
export function checkInvoiceMonth(invoiceDate: string, now: Date = serverNow()): MonthRuleResult {
  if (!isValidIsoDate(invoiceDate)) {
    return { ok: false, reason: 'INVALID_DATE', message: 'Invoice date must be a valid date in YYYY-MM-DD format' };
  }
  const k = karachiParts(now);
  const [y, m] = invoiceDate.split('-').map(Number);
  if (y !== k.year || m !== k.month) {
    return { ok: false, reason: 'OUTSIDE_CURRENT_MONTH', message: MONTH_RULE_MESSAGE };
  }
  return { ok: true };
}

/** Convert a JS Date stored as @db.Date (UTC midnight) back to YYYY-MM-DD. */
export function dateOnlyToIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function isoToDateOnly(s: string): Date {
  return new Date(`${s}T00:00:00.000Z`);
}

/** dd-MMM-yyyy (e.g. 04-Feb-2024) — used by some FBR reference endpoints. */
export function toDdMmmYyyy(iso: string): string {
  const [y, m, d] = iso.split('-');
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m) - 1];
  return `${d}-${mon}-${y}`;
}
