import { Decimal } from 'decimal.js';
import { parseRate, type ParsedRate } from './rate.js';

/**
 * Exact-decimal line calculations. Rules (docs/CALCULATIONS.md):
 *  - valueSalesExcludingST = quantity × unitPrice − discount   (discount is applied ONCE, here)
 *  - fixedNotifiedValueOrRetailPrice = retailPricePerUnit × quantity (when a per-unit retail price is given)
 *  - salesTaxApplicable:
 *      EXEMPT                  -> 0
 *      PERCENT                 -> base × rate%   (base = retail value for 3rd Schedule, else valueSalesExcludingST)
 *      FIXED_PER_UNIT          -> quantity × perUnit
 *      COMPOSITE               -> valueSalesExcludingST × rate% + quantity × perUnit
 *      UNKNOWN                 -> user-entered (not calculated)
 *  - totalValues = valueSalesExcludingST + salesTaxApplicable + furtherTax + extraTax + fedPayable
 *  - Withholding is NOT deducted from the gross; netReceivable = gross − salesTaxWithheldAtSource.
 *  - Rounding: full precision internally, ROUND_HALF_UP to 2 dp for amounts, 4 dp for quantity.
 *  - Further tax is never applied automatically by a universal rule.
 */
Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export const D = (v: Decimal.Value | null | undefined): Decimal => {
  if (v === null || v === undefined || v === '') return new Decimal(0);
  return new Decimal(v);
};
export const money = (v: Decimal) => v.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
export const qty4 = (v: Decimal) => v.toDecimalPlaces(4, Decimal.ROUND_HALF_UP);

export interface ItemInput {
  saleType: string;
  rate: string;
  quantity: Decimal.Value;
  unitPrice: Decimal.Value;
  discount?: Decimal.Value | null;
  retailPricePerUnit?: Decimal.Value | null;
  fixedNotifiedValueOrRetailPrice?: Decimal.Value | null;
  valueSalesExcludingST?: Decimal.Value | null;
  salesTaxApplicable?: Decimal.Value | null;
  extraTax?: Decimal.Value | null;
  furtherTax?: Decimal.Value | null;
  fedPayable?: Decimal.Value | null;
  salesTaxWithheldAtSource?: Decimal.Value | null;
  totalValues?: Decimal.Value | null;
}

export interface ItemComputed {
  quantity: Decimal;
  unitPrice: Decimal;
  discount: Decimal;
  grossValue: Decimal;
  valueSalesExcludingST: Decimal;
  fixedNotifiedValueOrRetailPrice: Decimal;
  salesTaxApplicable: Decimal;
  extraTax: Decimal;
  furtherTax: Decimal;
  fedPayable: Decimal;
  salesTaxWithheldAtSource: Decimal;
  totalValues: Decimal;
  rate: ParsedRate;
  salesTaxCalculated: boolean;
}

export interface CalcIssue {
  field: string;
  level: 'error' | 'warning';
  message: string;
}

export const isThirdSchedule = (saleType: string) => /3rd\s*schedule|third\s*schedule/i.test(saleType);

/** Compute derived fields (auto mode). */
export function computeItem(input: ItemInput): { values: ItemComputed; issues: CalcIssue[] } {
  const issues: CalcIssue[] = [];
  const quantity = qty4(D(input.quantity));
  const unitPrice = D(input.unitPrice);
  const discount = money(D(input.discount));
  const grossValue = money(quantity.mul(unitPrice));
  const valueSalesExcludingST = money(grossValue.minus(discount));
  const rate = parseRate(input.rate);
  const third = isThirdSchedule(input.saleType);

  if (quantity.lte(0)) issues.push({ field: 'quantity', level: 'error', message: 'Quantity must be greater than zero' });
  if (unitPrice.lt(0)) issues.push({ field: 'unitPrice', level: 'error', message: 'Unit price cannot be negative' });
  if (discount.lt(0)) issues.push({ field: 'discount', level: 'error', message: 'Discount cannot be negative' });
  if (discount.gt(grossValue)) issues.push({ field: 'discount', level: 'error', message: 'Discount cannot exceed quantity × unit price' });

  let fixedNotified = money(D(input.fixedNotifiedValueOrRetailPrice));
  if (input.retailPricePerUnit !== null && input.retailPricePerUnit !== undefined && input.retailPricePerUnit !== '') {
    fixedNotified = money(D(input.retailPricePerUnit).mul(quantity));
  }
  if (third && fixedNotified.lte(0)) {
    issues.push({
      field: 'fixedNotifiedValueOrRetailPrice',
      level: 'error',
      message: 'Third Schedule goods are taxed on retail price: enter the retail price per unit (FBR error 0090/0102)',
    });
  }

  let salesTax: Decimal;
  let calculated = true;
  switch (rate.kind) {
    case 'EXEMPT':
      salesTax = new Decimal(0);
      break;
    case 'PERCENT':
      salesTax = money((third ? fixedNotified : valueSalesExcludingST).mul(rate.percent!).div(100));
      break;
    case 'FIXED_PER_UNIT':
      salesTax = money(quantity.mul(rate.perUnit!));
      break;
    case 'COMPOSITE':
      salesTax = money(valueSalesExcludingST.mul(rate.percent!).div(100).plus(quantity.mul(rate.perUnit!)));
      break;
    default:
      calculated = false;
      salesTax = money(D(input.salesTaxApplicable));
      issues.push({
        field: 'salesTaxApplicable',
        level: 'warning',
        message: `Rate "${rate.raw || '(empty)'}" cannot be calculated automatically — enter the sales tax amount manually`,
      });
  }

  const extraTax = money(D(input.extraTax));
  const furtherTax = money(D(input.furtherTax));
  const fedPayable = money(D(input.fedPayable));
  const withheld = money(D(input.salesTaxWithheldAtSource));
  for (const [f, v] of [['extraTax', extraTax], ['furtherTax', furtherTax], ['fedPayable', fedPayable], ['salesTaxWithheldAtSource', withheld]] as const) {
    if (v.lt(0)) issues.push({ field: f, level: 'error', message: 'Amount cannot be negative' });
  }
  if (!withheld.isZero() && !withheld.eq(salesTax)) {
    issues.push({
      field: 'salesTaxWithheldAtSource',
      level: 'warning',
      message: 'FBR error 0008: ST withheld at source should be either zero or equal to the sales tax',
    });
  }
  const totalValues = money(valueSalesExcludingST.plus(salesTax).plus(furtherTax).plus(extraTax).plus(fedPayable));

  return {
    values: {
      quantity,
      unitPrice,
      discount,
      grossValue,
      valueSalesExcludingST,
      fixedNotifiedValueOrRetailPrice: fixedNotified,
      salesTaxApplicable: salesTax,
      extraTax,
      furtherTax,
      fedPayable,
      salesTaxWithheldAtSource: withheld,
      totalValues,
      rate,
      salesTaxCalculated: calculated,
    },
    issues,
  };
}

/**
 * Manual mode (e.g. supplied scenario templates): keep the entered values, but report
 * differences from the general formula for review — never silently overwrite them.
 */
export function discrepancies(input: ItemInput): CalcIssue[] {
  const { values } = computeItem(input);
  const out: CalcIssue[] = [];
  const cmp = (field: keyof ItemInput, expected: Decimal, label: string) => {
    const raw = input[field];
    if (raw === null || raw === undefined || raw === '') return;
    const entered = D(raw as Decimal.Value);
    if (!money(entered).eq(expected)) {
      out.push({
        field,
        level: 'warning',
        message: `${label}: entered ${money(entered).toFixed(2)}, general formula gives ${expected.toFixed(2)} (kept as entered — review)`,
      });
    }
  };
  if (D(input.unitPrice).gt(0)) cmp('valueSalesExcludingST', values.valueSalesExcludingST, 'Value of sales excl. ST');
  if (values.salesTaxCalculated) cmp('salesTaxApplicable', values.salesTaxApplicable, 'Sales tax');
  const enteredTotal = D(input.totalValues);
  const parts = money(
    D(input.valueSalesExcludingST)
      .plus(D(input.salesTaxApplicable))
      .plus(D(input.furtherTax))
      .plus(D(input.extraTax))
      .plus(D(input.fedPayable)),
  );
  if (!enteredTotal.isZero() && !money(enteredTotal).eq(parts)) {
    out.push({
      field: 'totalValues',
      level: 'warning',
      message: `Total (incl. taxes): entered ${money(enteredTotal).toFixed(2)}, sum of components is ${parts.toFixed(2)} (kept as entered — review)`,
    });
  }
  return out;
}

export interface TotalsInput {
  valueSalesExcludingST: Decimal.Value;
  salesTaxApplicable: Decimal.Value;
  furtherTax: Decimal.Value;
  extraTax: Decimal.Value;
  fedPayable: Decimal.Value;
  salesTaxWithheldAtSource: Decimal.Value;
  discount: Decimal.Value;
}

export function invoiceTotals(items: TotalsInput[]) {
  const sum = (k: keyof TotalsInput) => money(items.reduce((a, it) => a.plus(D(it[k])), new Decimal(0)));
  const totalValueExclST = sum('valueSalesExcludingST');
  const totalSalesTax = sum('salesTaxApplicable');
  const totalFurtherTax = sum('furtherTax');
  const totalExtraTax = sum('extraTax');
  const totalFed = sum('fedPayable');
  const totalWithheld = sum('salesTaxWithheldAtSource');
  const totalDiscount = sum('discount');
  const grandTotal = money(totalValueExclST.plus(totalSalesTax).plus(totalFurtherTax).plus(totalExtraTax).plus(totalFed));
  return {
    totalValueExclST,
    totalSalesTax,
    totalFurtherTax,
    totalExtraTax,
    totalFed,
    totalWithheld,
    totalDiscount,
    grandTotal,
    netReceivable: money(grandTotal.minus(totalWithheld)),
  };
}
