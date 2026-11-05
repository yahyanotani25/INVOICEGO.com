import { describe, expect, it } from 'vitest';
import { parseRate } from '../src/fbr/rate';
import { computeItem, discrepancies, invoiceTotals } from '../src/fbr/calc';

const base = { saleType: 'Goods at standard rate (default)', rate: '18%', quantity: '1', unitPrice: '0' };

describe('rate parsing', () => {
  it('parses documented rate shapes', () => {
    expect(parseRate('18%')).toMatchObject({ kind: 'PERCENT' });
    expect(parseRate('1.43%').percent!.toString()).toBe('1.43');
    expect(parseRate('Exempt').kind).toBe('EXEMPT');
    expect(parseRate('Rs.3 per unit')).toMatchObject({ kind: 'FIXED_PER_UNIT' });
    expect(parseRate('Rs.200/unit').perUnit!.toString()).toBe('200');
    expect(parseRate('18% + Rs.60/kg')).toMatchObject({ kind: 'COMPOSITE' });
    expect(parseRate('18% along with rupees 60 per kilogram')).toMatchObject({ kind: 'COMPOSITE' });
    expect(parseRate('DTRE').kind).toBe('UNKNOWN');
    expect(parseRate('').kind).toBe('UNKNOWN');
  });
});

describe('exact-decimal item calculations', () => {
  it('percentage rate with discount applied exactly once', () => {
    const { values, issues } = computeItem({ ...base, quantity: '10', unitPrice: '1000', discount: '500' });
    expect(values.grossValue.toFixed(2)).toBe('10000.00');
    expect(values.valueSalesExcludingST.toFixed(2)).toBe('9500.00');
    expect(values.salesTaxApplicable.toFixed(2)).toBe('1710.00');
    expect(values.totalValues.toFixed(2)).toBe('11210.00');
    expect(issues.filter((i) => i.level === 'error')).toEqual([]);
  });

  it('Third Schedule tax is on retail price x quantity', () => {
    const { values } = computeItem({ ...base, saleType: '3rd Schedule Goods', quantity: '100', unitPrice: '8', retailPricePerUnit: '10' });
    expect(values.fixedNotifiedValueOrRetailPrice.toFixed(2)).toBe('1000.00');
    expect(values.salesTaxApplicable.toFixed(2)).toBe('180.00');
  });

  it('Third Schedule without a retail price is an error', () => {
    const { issues } = computeItem({ ...base, saleType: '3rd Schedule Goods', quantity: '1', unitPrice: '10' });
    expect(issues.some((i) => i.field === 'fixedNotifiedValueOrRetailPrice' && i.level === 'error')).toBe(true);
  });

  it('fixed per-unit rate: Rs.3 per unit x 12 = 36', () => {
    const { values } = computeItem({ ...base, rate: 'Rs.3 per unit', quantity: '12', unitPrice: '10.25' });
    expect(values.salesTaxApplicable.toFixed(2)).toBe('36.00');
  });

  it('composite rate: 18% + Rs.60/kg on value 100, qty 1 = 78', () => {
    const { values } = computeItem({ ...base, rate: '18% + Rs.60/kg', quantity: '1', unitPrice: '100' });
    expect(values.salesTaxApplicable.toFixed(2)).toBe('78.00');
  });

  it('exempt and zero-rated give zero tax', () => {
    expect(computeItem({ ...base, rate: 'Exempt', quantity: '1', unitPrice: '10' }).values.salesTaxApplicable.toFixed(2)).toBe('0.00');
    expect(computeItem({ ...base, rate: '0%', quantity: '1', unitPrice: '10' }).values.salesTaxApplicable.toFixed(2)).toBe('0.00');
  });

  it('unknown rate keeps the user-entered sales tax and warns', () => {
    const { values, issues } = computeItem({ ...base, rate: 'DTRE', quantity: '1', unitPrice: '100', salesTaxApplicable: '55.5' });
    expect(values.salesTaxApplicable.toFixed(2)).toBe('55.50');
    expect(values.salesTaxCalculated).toBe(false);
    expect(issues.some((i) => i.level === 'warning' && i.field === 'salesTaxApplicable')).toBe(true);
  });

  it('rounds half-up (not banker’s rounding) and avoids float errors', () => {
    expect(computeItem({ ...base, rate: '1%', quantity: '1', unitPrice: '50.5' }).values.salesTaxApplicable.toFixed(2)).toBe('0.51');
    expect(computeItem({ ...base, rate: '0%', quantity: '1', unitPrice: '0.125' }).values.valueSalesExcludingST.toFixed(2)).toBe('0.13');
    expect(computeItem({ ...base, rate: '0%', quantity: '3', unitPrice: '0.1' }).values.valueSalesExcludingST.toFixed(2)).toBe('0.30');
    expect(computeItem({ ...base, rate: '1.43%', quantity: '1', unitPrice: '100' }).values.salesTaxApplicable.toFixed(2)).toBe('1.43');
    expect(computeItem({ ...base, quantity: '1.5', unitPrice: '0.2' }).values.valueSalesExcludingST.toFixed(2)).toBe('0.30');
  });

  it('includes further/extra/FED in total and validates withholding (0008)', () => {
    const { values, issues } = computeItem({ ...base, quantity: '1', unitPrice: '1000', furtherTax: '40', extraTax: '5', fedPayable: '10', salesTaxWithheldAtSource: '100' });
    expect(values.totalValues.toFixed(2)).toBe('1235.00');
    expect(issues.some((i) => i.field === 'salesTaxWithheldAtSource' && i.message.includes('0008'))).toBe(true);
  });

  it('rejects negative values and discount above gross', () => {
    const { issues } = computeItem({ ...base, quantity: '1', unitPrice: '100', discount: '150', furtherTax: '-1' });
    expect(issues.filter((i) => i.level === 'error').map((i) => i.field)).toEqual(expect.arrayContaining(['discount', 'furtherTax']));
  });

  it('discrepancies() reports differences but never overwrites the entered values', () => {
    const input = { ...base, quantity: '1', unitPrice: '1000', valueSalesExcludingST: '1000', salesTaxApplicable: '200', totalValues: '999' };
    const d = discrepancies(input);
    expect(d.map((x) => x.field)).toEqual(expect.arrayContaining(['salesTaxApplicable', 'totalValues']));
    expect(d.every((x) => x.level === 'warning')).toBe(true);
    expect(input.salesTaxApplicable).toBe('200');
  });

  it('invoiceTotals keeps gross and net receivable distinct', () => {
    const t = invoiceTotals([
      { valueSalesExcludingST: '1000', salesTaxApplicable: '180', furtherTax: '40', extraTax: '0', fedPayable: '0', salesTaxWithheldAtSource: '180', discount: '0' },
      { valueSalesExcludingST: '0.10', salesTaxApplicable: '0.20', furtherTax: '0', extraTax: '0', fedPayable: '0', salesTaxWithheldAtSource: '0', discount: '5' },
    ]);
    expect(t.grandTotal.toFixed(2)).toBe('1220.30');
    expect(t.netReceivable.toFixed(2)).toBe('1040.30');
    expect(t.totalDiscount.toFixed(2)).toBe('5.00');
  });
});
