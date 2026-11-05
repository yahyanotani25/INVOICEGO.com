import { Decimal } from 'decimal.js';
import { sha256Hex } from '../lib/crypto.js';

/**
 * Exact FBR DI request contract (Technical Specification v1.12 §4.1/§4.2).
 * Property names are case-sensitive and copied from the JSON samples
 * (the field table's "buyeRegistrationType"/"InvoiceType" typos are NOT used).
 */
export const HEADER_KEYS = [
  'invoiceType',
  'invoiceDate',
  'sellerNTNCNIC',
  'sellerBusinessName',
  'sellerProvince',
  'sellerAddress',
  'buyerNTNCNIC',
  'buyerBusinessName',
  'buyerProvince',
  'buyerAddress',
  'buyerRegistrationType',
  'invoiceRefNo',
  'scenarioId', // sandbox only
  'items',
] as const;

export const ITEM_KEYS = [
  'hsCode',
  'productDescription',
  'rate',
  'uoM',
  'quantity',
  'totalValues',
  'valueSalesExcludingST',
  'fixedNotifiedValueOrRetailPrice',
  'salesTaxApplicable',
  'salesTaxWithheldAtSource',
  'extraTax',
  'furtherTax',
  'sroScheduleNo',
  'fedPayable',
  'discount',
  'saleType',
  'sroItemSerialNo',
] as const;

export const INVOICE_TYPE_API = { SALE_INVOICE: 'Sale Invoice', DEBIT_NOTE: 'Debit Note' } as const;
export const REG_TYPE_API = { REGISTERED: 'Registered', UNREGISTERED: 'Unregistered' } as const;

export type Env = 'SANDBOX' | 'PRODUCTION';

export interface PayloadInvoice {
  invoiceType: keyof typeof INVOICE_TYPE_API;
  invoiceDate: string; // YYYY-MM-DD
  sellerNtnCnic: string;
  sellerBusinessName: string;
  sellerProvince: string;
  sellerAddress: string;
  buyerNtnCnic: string;
  buyerBusinessName: string;
  buyerProvince: string;
  buyerAddress: string;
  buyerRegistrationType: keyof typeof REG_TYPE_API | null;
  invoiceRefNo: string;
  scenarioId: string | null;
  items: PayloadItem[];
}

export interface PayloadItem {
  hsCode: string;
  productDescription: string;
  rate: string;
  uom: string;
  quantity: Decimal.Value;
  totalValues: Decimal.Value;
  valueSalesExcludingST: Decimal.Value;
  fixedNotifiedValueOrRetailPrice: Decimal.Value;
  salesTaxApplicable: Decimal.Value;
  salesTaxWithheldAtSource: Decimal.Value;
  extraTax: Decimal.Value;
  extraTaxEmpty: boolean;
  furtherTax: Decimal.Value;
  sroScheduleNo: string;
  fedPayable: Decimal.Value;
  discount: Decimal.Value;
  saleType: string;
  sroItemSerialNo: string;
}

/** Marker for numbers that must be emitted as exact JSON numeric literals. */
class Num {
  constructor(readonly literal: string) {}
}
const amount = (v: Decimal.Value) => new Num(new Decimal(v ?? 0).toFixed(2));
const quantity = (v: Decimal.Value) => new Num(new Decimal(v ?? 0).toDecimalPlaces(4).toString());

type Node = string | Num | Node[] | { [k: string]: Node };

/**
 * Build the ordered request object. Application-only fields (payment mode, display time,
 * internal number, retail price per unit, notes) are never included.
 * scenarioId is included for SANDBOX and omitted for PRODUCTION.
 */
export function buildPayload(inv: PayloadInvoice, env: Env): { [k: string]: Node } {
  const out: { [k: string]: Node } = {
    invoiceType: INVOICE_TYPE_API[inv.invoiceType],
    invoiceDate: inv.invoiceDate,
    sellerNTNCNIC: inv.sellerNtnCnic.trim(),
    sellerBusinessName: inv.sellerBusinessName.trim(),
    sellerProvince: inv.sellerProvince,
    sellerAddress: inv.sellerAddress.trim(),
    buyerNTNCNIC: (inv.buyerNtnCnic ?? '').trim(),
    buyerBusinessName: inv.buyerBusinessName.trim(),
    buyerProvince: inv.buyerProvince,
    buyerAddress: inv.buyerAddress.trim(),
    buyerRegistrationType: inv.buyerRegistrationType ? REG_TYPE_API[inv.buyerRegistrationType] : '',
    invoiceRefNo: inv.invoiceRefNo ?? '',
  };
  if (env === 'SANDBOX') out.scenarioId = inv.scenarioId ?? '';
  out.items = inv.items.map((it) => ({
    hsCode: it.hsCode.trim(),
    productDescription: it.productDescription,
    rate: it.rate,
    uoM: it.uom,
    quantity: quantity(it.quantity),
    totalValues: amount(it.totalValues),
    valueSalesExcludingST: amount(it.valueSalesExcludingST),
    fixedNotifiedValueOrRetailPrice: amount(it.fixedNotifiedValueOrRetailPrice),
    salesTaxApplicable: amount(it.salesTaxApplicable),
    salesTaxWithheldAtSource: amount(it.salesTaxWithheldAtSource),
    // Contract type is Number; "" only when the user explicitly chose "send as empty" (error 0091) — SOURCE_CONFLICTS A4
    extraTax: it.extraTaxEmpty ? '' : amount(it.extraTax),
    furtherTax: amount(it.furtherTax),
    sroScheduleNo: it.sroScheduleNo ?? '',
    fedPayable: amount(it.fedPayable),
    discount: amount(it.discount),
    saleType: it.saleType,
    sroItemSerialNo: it.sroItemSerialNo ?? '',
  }));
  return out;
}

function ser(n: Node, indent: string, step: string): string {
  if (n instanceof Num) return n.literal;
  if (typeof n === 'string') return JSON.stringify(n);
  const nl = step ? '\n' : '';
  const inner = indent + step;
  if (Array.isArray(n)) {
    if (n.length === 0) return '[]';
    return '[' + nl + n.map((x) => inner + ser(x, inner, step)).join(',' + nl) + nl + indent + ']';
  }
  const keys = Object.keys(n);
  if (keys.length === 0) return '{}';
  const sep = step ? ': ' : ':';
  return '{' + nl + keys.map((k) => inner + JSON.stringify(k) + sep + ser(n[k], inner, step)).join(',' + nl) + nl + indent + '}';
}

/** Serialize with exact decimal literals. The returned text is exactly what is sent and stored. */
export function serializePayload(p: { [k: string]: Node }, pretty = true): string {
  return ser(p, '', pretty ? '  ' : '');
}

export function payloadHash(text: string): string {
  return sha256Hex(text);
}
