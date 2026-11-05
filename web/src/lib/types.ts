import type { Issue } from './api';

export interface InvoiceItem {
  id?: string;
  lineNo?: number;
  productId: string | null;
  saleType: string;
  hsCode: string;
  productDescription: string;
  rate: string;
  uom: string;
  quantity: string | null;
  unitPrice: string | null;
  discount: string | null;
  valueSalesExcludingST: string | null;
  salesTaxApplicable: string | null;
  retailPricePerUnit: string | null;
  fixedNotifiedValueOrRetailPrice: string | null;
  extraTax: string | null;
  extraTaxEmpty: boolean;
  furtherTax: string | null;
  fedPayable: string | null;
  salesTaxWithheldAtSource: string | null;
  sroScheduleNo: string;
  sroItemSerialNo: string;
  totalValues: string | null;
  fbr?: { itemInvoiceNo: string | null; statusCode: string | null; errorCode: string | null; error: string | null };
}

export interface Invoice {
  id: string;
  environment: 'SANDBOX' | 'PRODUCTION';
  internalNumber: string;
  invoiceType: 'SALE_INVOICE' | 'DEBIT_NOTE';
  invoiceDate: string;
  invoiceTime: string;
  paymentMode: string | null;
  invoiceRefNo: string;
  scenarioId: string | null;
  seller: { ntnCnic: string; businessName: string; province: string; address: string };
  customerId: string | null;
  buyerNtnCnic: string;
  buyerBusinessName: string;
  buyerProvince: string;
  buyerAddress: string;
  buyerRegistrationType: 'REGISTERED' | 'UNREGISTERED' | null;
  buyerCheck: { result: string; checkedAt: string | null };
  status: string;
  source: string;
  autoCalc: boolean;
  notes: string | null;
  totals: Record<'valueExclST' | 'salesTax' | 'furtherTax' | 'extraTax' | 'fed' | 'withheld' | 'discount' | 'grandTotal' | 'netReceivable', string>;
  fbrInvoiceNumber: string | null;
  fbrDated: string | null;
  acceptedAt: string | null;
  acceptedViaReconcile: boolean;
  reconciliationNote: string | null;
  validated: boolean;
  lastValidatedAt: string | null;
  rawTemplateDiff: unknown;
  importRef: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  items: InvoiceItem[];
}

export interface ExplainedIssue {
  scope: 'HTTP' | 'INVOICE' | 'ITEM' | 'NETWORK';
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

export interface FbrActionResult {
  invoice: Invoice;
  outcome: string;
  attemptId: string | null;
  issues: ExplainedIssue[];
  localIssues: Issue[];
  buyerCheck: BuyerCheck | null;
  httpStatus: number | null;
  rawResponse: string | null;
}

export interface BuyerCheck {
  result: 'NOT_CHECKED' | 'REGISTERED' | 'UNREGISTERED' | 'UNAVAILABLE';
  mismatch: boolean;
  message: string | null;
  checkedAt: string | null;
}

export interface Lookups {
  provinces: { source: string; values: string[] };
  uoms: { source: string; values: string[] };
  saleTypes: { source: string; values: string[] };
  rates: { source: string; values: string[] };
  sroSchedules: { source: string; values: string[] };
  invoiceTypes: { value: string; label: string }[];
  paymentModes: string[];
  businessActivities: string[];
  sectors: string[];
  today: { date: string; time: string; year: number; month: number; monthStart: string; monthEnd: string };
}

export interface Customer {
  id: string;
  name: string;
  ntnCnic: string | null;
  strn: string | null;
  province: string;
  address: string;
  registrationType: 'REGISTERED' | 'UNREGISTERED';
  phone: string | null;
  email: string | null;
  category: string | null;
  verifiedResult: string;
  verifiedAt: string | null;
}

export interface Product {
  id: string;
  sku: string;
  description: string;
  hsCode: string;
  uom: string;
  saleType: string;
  rate: string | null;
  unitPrice: string;
  retailPrice: string | null;
  sroScheduleNo: string | null;
  sroItemSerialNo: string | null;
}

export const MONTH_RULE_MESSAGE = "You can't create future or previous month invoices";

export const emptyItem = (): InvoiceItem => ({
  productId: null,
  saleType: '',
  hsCode: '',
  productDescription: '',
  rate: '',
  uom: '',
  quantity: '1',
  unitPrice: '',
  discount: '',
  valueSalesExcludingST: null,
  salesTaxApplicable: null,
  retailPricePerUnit: '',
  fixedNotifiedValueOrRetailPrice: null,
  extraTax: '',
  extraTaxEmpty: false,
  furtherTax: '',
  fedPayable: '',
  salesTaxWithheldAtSource: '',
  sroScheduleNo: '',
  sroItemSerialNo: '',
  totalValues: null,
});
