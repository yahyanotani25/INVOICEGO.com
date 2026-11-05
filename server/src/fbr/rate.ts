import { Decimal } from 'decimal.js';

/**
 * FBR rates are strings (ratE_DESC from reference API 5.8), e.g.
 *   "18%", "1.43%", "0%", "Exempt", "Rs.3 per unit", "Rs.200/unit",
 *   "18% + Rs.60/kg", "18% along with rupees 60 per kilogram".
 * They are NOT always simple percentages. Anything we cannot parse is UNKNOWN and
 * must be calculated manually by the user (never guessed).
 */
export type RateKind = 'PERCENT' | 'FIXED_PER_UNIT' | 'COMPOSITE' | 'EXEMPT' | 'UNKNOWN';

export interface ParsedRate {
  raw: string;
  kind: RateKind;
  percent?: Decimal;
  perUnit?: Decimal;
  unitLabel?: string;
}

const PCT = /(\d+(?:\.\d+)?)\s*%/;
const PER_UNIT = /(?:rs\.?|rupees|pkr)\s*(\d+(?:\.\d+)?)\s*(?:\/|per)\s*([a-z][a-z .]*)/i;

export function parseRate(raw: string | null | undefined): ParsedRate {
  const s = (raw ?? '').trim();
  if (!s) return { raw: s, kind: 'UNKNOWN' };
  if (/^exempt/i.test(s)) return { raw: s, kind: 'EXEMPT' };
  const pct = PCT.exec(s);
  const pu = PER_UNIT.exec(s);
  if (pct && pu) {
    return { raw: s, kind: 'COMPOSITE', percent: new Decimal(pct[1]), perUnit: new Decimal(pu[1]), unitLabel: pu[2].trim() };
  }
  if (pct) {
    // Reject strings that carry extra unparsed semantics after the percentage (e.g. "18% along with …" without a parsable amount)
    const rest = s.replace(PCT, '').trim();
    if (rest === '') return { raw: s, kind: 'PERCENT', percent: new Decimal(pct[1]) };
    return { raw: s, kind: 'UNKNOWN', percent: new Decimal(pct[1]) };
  }
  if (pu) return { raw: s, kind: 'FIXED_PER_UNIT', perUnit: new Decimal(pu[1]), unitLabel: pu[2].trim() };
  return { raw: s, kind: 'UNKNOWN' };
}
