import { afterEach, describe, expect, it } from 'vitest';
import { __setClock, checkInvoiceMonth, isValidIsoDate, karachiNow, karachiParts, MONTH_RULE_MESSAGE } from '../src/lib/time';

const MSG = "You can't create future or previous month invoices";
const at = (iso: string) => new Date(iso);

describe('current-month invoice rule (Asia/Karachi)', () => {
  afterEach(() => __setClock(null));

  it('uses the exact client-mandated message', () => {
    expect(MONTH_RULE_MESSAGE).toBe(MSG);
  });

  it('accepts any date in the current calendar month, including later days', () => {
    const now = at('2026-11-15T07:00:00Z'); // 15 Nov 12:00 PKT
    expect(checkInvoiceMonth('2026-11-01', now)).toEqual({ ok: true });
    expect(checkInvoiceMonth('2026-11-15', now)).toEqual({ ok: true });
    expect(checkInvoiceMonth('2026-11-30', now)).toEqual({ ok: true }); // no extra "no future day" rule
  });

  it('rejects previous and next month with the exact message', () => {
    const now = at('2026-11-15T07:00:00Z');
    const prev = checkInvoiceMonth('2026-10-31', now);
    const next = checkInvoiceMonth('2026-12-01', now);
    expect(prev).toMatchObject({ ok: false, reason: 'OUTSIDE_CURRENT_MONTH', message: MSG });
    expect(next).toMatchObject({ ok: false, reason: 'OUTSIDE_CURRENT_MONTH', message: MSG });
    expect(checkInvoiceMonth('2025-11-15', now)).toMatchObject({ ok: false, message: MSG }); // same month, other year
  });

  it('evaluates the month in PKT, not UTC (UTC 30 Nov 19:30 = 1 Dec 00:30 PKT)', () => {
    const now = at('2026-11-30T19:30:00Z');
    expect(karachiParts(now).date).toBe('2026-12-01');
    expect(checkInvoiceMonth('2026-12-01', now)).toEqual({ ok: true });
    expect(checkInvoiceMonth('2026-11-30', now)).toMatchObject({ ok: false, message: MSG });
  });

  it('UTC 30 Nov 18:59 is still November in PKT', () => {
    const now = at('2026-11-30T18:59:00Z');
    expect(karachiParts(now).date).toBe('2026-11-30');
    expect(checkInvoiceMonth('2026-11-30', now)).toEqual({ ok: true });
    expect(checkInvoiceMonth('2026-12-01', now)).toMatchObject({ ok: false });
  });

  it('handles year rollover (UTC 31 Dec 19:00 = 1 Jan PKT)', () => {
    const now = at('2026-12-31T19:00:00Z');
    expect(karachiParts(now)).toMatchObject({ date: '2027-01-01', year: 2027, month: 1, monthStart: '2027-01-01', monthEnd: '2027-01-31' });
    expect(checkInvoiceMonth('2027-01-01', now)).toEqual({ ok: true });
    expect(checkInvoiceMonth('2026-12-31', now)).toMatchObject({ ok: false, message: MSG });
  });

  it('is a calendar-month rule, not a rolling 30-day window', () => {
    const first = at('2026-11-01T05:00:00Z'); // 1 Nov 10:00 PKT
    expect(checkInvoiceMonth('2026-10-31', first)).toMatchObject({ ok: false }); // yesterday rejected
    const thirtieth = at('2026-11-30T05:00:00Z');
    expect(checkInvoiceMonth('2026-11-01', thirtieth)).toEqual({ ok: true }); // 29 days earlier accepted
  });

  it('rejects invalid calendar dates and formats', () => {
    const now = at('2026-02-10T05:00:00Z');
    expect(isValidIsoDate('2026-02-30')).toBe(false);
    expect(isValidIsoDate('2028-02-29')).toBe(true);
    expect(checkInvoiceMonth('2026-02-30', now)).toMatchObject({ ok: false, reason: 'INVALID_DATE' });
    expect(checkInvoiceMonth('10/02/2026', now)).toMatchObject({ ok: false, reason: 'INVALID_DATE' });
  });

  it('uses the overridable trusted server clock', () => {
    __setClock(() => at('2027-03-05T00:00:00Z'));
    expect(karachiNow().date).toBe('2027-03-05');
    expect(checkInvoiceMonth('2027-03-31')).toEqual({ ok: true });
    expect(checkInvoiceMonth('2027-02-28')).toMatchObject({ ok: false, message: MSG });
  });
});
