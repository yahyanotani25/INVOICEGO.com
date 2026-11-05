import { HEADER_KEYS, ITEM_KEYS } from '../../fbr/payload.js';
import { checkInvoiceMonth, MONTH_RULE_MESSAGE } from '../../lib/time.js';
import type { InvoiceInput } from '../invoices/schema.js';

export interface Change {
  field: string;
  from: unknown;
  to: unknown;
  reason: string;
}

type Json = Record<string, unknown>;

/**
 * Prepare a supplied scenario example for a new attempt. The original template is never
 * modified; every change is returned so the UI can show it.
 */
export function prepareTemplate(
  template: Json,
  seller: { ntnCnic: string; name: string; province: string; address: string },
  today: string,
): { prepared: Json; changes: Change[]; stripped: string[]; warnings: string[] } {
  const changes: Change[] = [];
  const stripped: string[] = [];
  const warnings: string[] = [];
  const prepared: Json = {};
  for (const k of HEADER_KEYS) {
    if (k === 'items') continue;
    prepared[k] = template[k] ?? '';
  }
  for (const k of Object.keys(template)) {
    if (!(HEADER_KEYS as readonly string[]).includes(k)) stripped.push(k);
  }
  const set = (field: string, to: unknown, reason: string) => {
    if (prepared[field] !== to) changes.push({ field, from: prepared[field], to, reason });
    prepared[field] = to;
  };
  set('sellerNTNCNIC', seller.ntnCnic, 'Replaced PRAL sample seller with your business profile');
  set('sellerBusinessName', seller.name, 'Replaced PRAL sample seller with your business profile');
  set('sellerProvince', seller.province, 'Replaced PRAL sample seller with your business profile');
  set('sellerAddress', seller.address, 'Replaced PRAL sample seller with your business profile');
  set('invoiceDate', today, `Supplied example date is outside the current month — ${MONTH_RULE_MESSAGE.toLowerCase()}; set to today (Asia/Karachi)`);
  if (!template.buyerRegistrationType) {
    warnings.push('The supplied example has no buyerRegistrationType (a required field). Select Registered or Unregistered before running.');
  }
  if (String(template.buyerNTNCNIC ?? '') === seller.ntnCnic) {
    warnings.push('Buyer NTN/CNIC equals your NTN/CNIC — FBR rejects self-invoicing (0058). Change the buyer.');
  }
  const items = Array.isArray(template.items) ? (template.items as Json[]) : [];
  prepared.items = items.map((it, i) => {
    const out: Json = {};
    for (const k of ITEM_KEYS) out[k] = it[k] ?? (['hsCode', 'productDescription', 'rate', 'uoM', 'sroScheduleNo', 'saleType', 'sroItemSerialNo'].includes(k) ? '' : 0);
    for (const k of Object.keys(it)) if (!(ITEM_KEYS as readonly string[]).includes(k)) stripped.push(`items[${i}].${k}`);
    if (it.extraTax === '') {
      out.extraTax = 0;
      changes.push({
        field: `items[${i}].extraTax`,
        from: '',
        to: 0,
        reason: 'Contract type is Number; sent as 0. If FBR returns 0091 "Extra tax must be empty", set it back to "" (sent as empty).',
      });
    }
    return out;
  });
  if (stripped.length) warnings.push(`Non-contract field(s) removed from the request: ${stripped.join(', ')}`);
  return { prepared, changes, stripped, warnings };
}

export interface ParseIssue {
  field: string;
  line?: number;
  level: 'error' | 'warning';
  message: string;
}

const num = (v: unknown): string | null => {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim())) return v.trim();
  return 'NaN';
};

/** Convert edited sandbox JSON (contract shape) into the invoice model. Server-authoritative. */
export function jsonToInvoiceInput(obj: unknown, expectedScenario: string): { input: InvoiceInput | null; issues: ParseIssue[]; stripped: string[] } {
  const issues: ParseIssue[] = [];
  const stripped: string[] = [];
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return { input: null, issues: [{ field: 'json', level: 'error', message: 'The request must be a JSON object' }], stripped };
  }
  const o = obj as Json;
  for (const k of Object.keys(o)) if (!(HEADER_KEYS as readonly string[]).includes(k)) stripped.push(k);
  const str = (k: string, required = true) => {
    const v = o[k];
    if (v === undefined || v === null) {
      if (required) issues.push({ field: k, level: 'error', message: `${k} is required` });
      return '';
    }
    if (typeof v !== 'string') {
      issues.push({ field: k, level: 'error', message: `${k} must be a string` });
      return String(v);
    }
    return v;
  };
  const invoiceTypeRaw = str('invoiceType');
  const invoiceType = /^sale invoice$/i.test(invoiceTypeRaw) ? 'SALE_INVOICE' : /^debit note$/i.test(invoiceTypeRaw) ? 'DEBIT_NOTE' : null;
  if (!invoiceType) issues.push({ field: 'invoiceType', level: 'error', message: 'invoiceType must be "Sale Invoice" or "Debit Note"' });
  const invoiceDate = str('invoiceDate');
  const m = checkInvoiceMonth(invoiceDate);
  if (!m.ok) issues.push({ field: 'invoiceDate', level: 'error', message: m.message });
  const regRaw = str('buyerRegistrationType', false);
  const reg = /^registered$/i.test(regRaw) ? 'REGISTERED' : /^unregistered$/i.test(regRaw) ? 'UNREGISTERED' : null;
  if (!reg) issues.push({ field: 'buyerRegistrationType', level: 'error', message: 'buyerRegistrationType must be "Registered" or "Unregistered"' });
  const scenarioId = str('scenarioId');
  if (scenarioId !== expectedScenario) issues.push({ field: 'scenarioId', level: 'error', message: `scenarioId must be ${expectedScenario} for this scenario` });
  for (const k of ['sellerNTNCNIC', 'sellerBusinessName', 'sellerProvince', 'sellerAddress']) str(k);

  const itemsRaw = o.items;
  if (!Array.isArray(itemsRaw) || itemsRaw.length === 0) {
    issues.push({ field: 'items', level: 'error', message: 'items must be a non-empty array' });
  }
  const items = (Array.isArray(itemsRaw) ? itemsRaw : []).map((raw, i) => {
    const line = i + 1;
    const it = (raw && typeof raw === 'object' ? raw : {}) as Json;
    for (const k of Object.keys(it)) if (!(ITEM_KEYS as readonly string[]).includes(k)) stripped.push(`items[${i}].${k}`);
    const s = (k: string) => {
      const v = it[k];
      if (v === undefined || v === null) return '';
      if (typeof v !== 'string') {
        issues.push({ field: k, line, level: 'error', message: `${k} must be a string` });
        return String(v);
      }
      return v;
    };
    const n = (k: string) => {
      const v = num(it[k]);
      if (v === 'NaN') {
        issues.push({ field: k, line, level: 'error', message: `${k} must be a number` });
        return null;
      }
      return v;
    };
    const extraTaxEmpty = it.extraTax === '';
    return {
      productId: null,
      saleType: s('saleType'),
      hsCode: s('hsCode'),
      productDescription: s('productDescription'),
      rate: s('rate'),
      uom: s('uoM'),
      quantity: n('quantity'),
      unitPrice: null,
      discount: n('discount'),
      valueSalesExcludingST: n('valueSalesExcludingST'),
      salesTaxApplicable: n('salesTaxApplicable'),
      retailPricePerUnit: null,
      fixedNotifiedValueOrRetailPrice: n('fixedNotifiedValueOrRetailPrice'),
      extraTax: extraTaxEmpty ? null : n('extraTax'),
      extraTaxEmpty,
      furtherTax: n('furtherTax'),
      fedPayable: n('fedPayable'),
      salesTaxWithheldAtSource: n('salesTaxWithheldAtSource'),
      sroScheduleNo: s('sroScheduleNo'),
      sroItemSerialNo: s('sroItemSerialNo'),
      totalValues: n('totalValues'),
    };
  });
  if (stripped.length) issues.push({ field: 'json', level: 'warning', message: `Non-contract field(s) will not be sent: ${stripped.join(', ')}` });
  if (issues.some((i) => i.level === 'error' && i.field !== 'invoiceDate' && i.field !== 'buyerRegistrationType')) {
    // structural errors: still return input when possible so the form can show values
  }
  const input: InvoiceInput = {
    invoiceType: invoiceType ?? 'SALE_INVOICE',
    invoiceDate,
    paymentMode: null,
    invoiceRefNo: str('invoiceRefNo', false),
    scenarioId: /^SN\d{3}$/.test(scenarioId) ? scenarioId : null,
    customerId: null,
    buyerNtnCnic: str('buyerNTNCNIC', false),
    buyerBusinessName: str('buyerBusinessName'),
    buyerProvince: str('buyerProvince'),
    buyerAddress: str('buyerAddress'),
    buyerRegistrationType: reg,
    autoCalc: false,
    notes: null,
    items,
  };
  return { input, issues, stripped };
}
