import ExcelJS from 'exceljs';
import { checkInvoiceMonth, isValidIsoDate } from '../../lib/time.js';
import type { InvoiceInput } from '../invoices/schema.js';

export interface Column {
  key: string;
  header: string;
  required: boolean | 'conditional';
  level: 'invoice' | 'item';
  text?: boolean;
  note: string;
  example: (string | number)[];
}

/** One row per invoice ITEM. Rows sharing an import_ref form one invoice; invoice-level columns must repeat identically. */
export const COLUMNS: Column[] = [
  { key: 'import_ref', header: 'import_ref', required: true, level: 'invoice', text: true, note: 'Your identifier grouping rows into one invoice (e.g. INV-1001). Same value on every item row of the invoice.', example: ['INV-1001', 'INV-1001', 'INV-1002'] },
  { key: 'invoice_type', header: 'invoice_type', required: true, level: 'invoice', text: true, note: 'Sale Invoice or Debit Note', example: ['Sale Invoice', 'Sale Invoice', 'Sale Invoice'] },
  { key: 'invoice_date', header: 'invoice_date', required: true, level: 'invoice', text: true, note: 'YYYY-MM-DD. Must be in the CURRENT month (Asia/Karachi).', example: [] },
  { key: 'payment_mode', header: 'payment_mode', required: false, level: 'invoice', text: true, note: 'e.g. Cash, Bank Transfer, Credit (not sent to FBR)', example: ['Cash', 'Cash', 'Credit'] },
  { key: 'invoice_ref_no', header: 'invoice_ref_no', required: 'conditional', level: 'invoice', text: true, note: 'Required for Debit Note: original FBR invoice number', example: ['', '', ''] },
  { key: 'scenario_id', header: 'scenario_id', required: 'conditional', level: 'invoice', text: true, note: 'Sandbox uploads only: SN001…SN028', example: ['SN001', 'SN001', 'SN002'] },
  { key: 'buyer_ntn_cnic', header: 'buyer_ntn_cnic', required: 'conditional', level: 'invoice', text: true, note: '7-digit NTN or 13-digit CNIC, digits only. Required for registered buyers. Keep this column as TEXT.', example: ['1234567', '1234567', ''] },
  { key: 'buyer_name', header: 'buyer_name', required: true, level: 'invoice', text: true, note: 'Buyer business name', example: ['ABC Traders', 'ABC Traders', 'Walk-in customer'] },
  { key: 'buyer_province', header: 'buyer_province', required: true, level: 'invoice', text: true, note: 'Province as per FBR provinces list', example: ['Punjab', 'Punjab', 'Sindh'] },
  { key: 'buyer_address', header: 'buyer_address', required: true, level: 'invoice', text: true, note: 'Buyer address', example: ['Lahore', 'Lahore', 'Karachi'] },
  { key: 'buyer_registration_type', header: 'buyer_registration_type', required: true, level: 'invoice', text: true, note: 'Registered or Unregistered', example: ['Registered', 'Registered', 'Unregistered'] },
  { key: 'sale_type', header: 'sale_type', required: true, level: 'item', text: true, note: 'Exact FBR sale type, e.g. Goods at standard rate (default)', example: ['Goods at standard rate (default)', 'Goods at standard rate (default)', 'Goods at standard rate (default)'] },
  { key: 'hs_code', header: 'hs_code', required: true, level: 'item', text: true, note: 'Format 0000.0000 — keep as TEXT so leading zeros are preserved', example: ['0101.2100', '1006.3090', '0101.2100'] },
  { key: 'product_description', header: 'product_description', required: true, level: 'item', text: true, note: 'Item description', example: ['Product A', 'Basmati rice 5kg', 'Product A'] },
  { key: 'tax_rate', header: 'tax_rate', required: true, level: 'item', text: true, note: 'Exact FBR rate text, e.g. 18% or Exempt or Rs.3 per unit', example: ['18%', '18%', '18%'] },
  { key: 'uom', header: 'uom', required: true, level: 'item', text: true, note: 'Exact FBR UOM, e.g. Numbers, pieces, units / KG / MT', example: ['Numbers, pieces, units', 'KG', 'Numbers, pieces, units'] },
  { key: 'quantity', header: 'quantity', required: true, level: 'item', note: 'Up to 4 decimals', example: [10, 5, 2] },
  { key: 'unit_price', header: 'unit_price', required: true, level: 'item', note: 'Unit price excluding sales tax (PKR)', example: [1000, 1850, 500] },
  { key: 'discount', header: 'discount', required: false, level: 'item', note: 'Discount amount for the line (PKR); deducted once from quantity × unit price', example: [0, 250, 0] },
  { key: 'retail_price_per_unit', header: 'retail_price_per_unit', required: 'conditional', level: 'item', note: 'Third Schedule goods: printed retail price per unit', example: ['', '', ''] },
  { key: 'sales_tax', header: 'sales_tax', required: 'conditional', level: 'item', note: 'Only for rates that cannot be calculated automatically; otherwise leave blank', example: ['', '', ''] },
  { key: 'extra_tax', header: 'extra_tax', required: false, level: 'item', note: 'Extra tax amount (blank = 0)', example: ['', '', ''] },
  { key: 'further_tax', header: 'further_tax', required: false, level: 'item', note: 'Further tax amount where applicable (blank = 0)', example: [0, 0, 40] },
  { key: 'fed_payable', header: 'fed_payable', required: false, level: 'item', note: 'FED payable (blank = 0)', example: ['', '', ''] },
  { key: 'st_withheld_at_source', header: 'st_withheld_at_source', required: false, level: 'item', note: 'Sales tax withheld at source: 0 or equal to the sales tax', example: ['', '', ''] },
  { key: 'sro_schedule_no', header: 'sro_schedule_no', required: 'conditional', level: 'item', text: true, note: 'SRO / schedule number where the rate requires it', example: ['', '', ''] },
  { key: 'sro_item_serial_no', header: 'sro_item_serial_no', required: 'conditional', level: 'item', text: true, note: 'Item serial number in the SRO', example: ['', '', ''] },
];

export const INVOICE_LEVEL = COLUMNS.filter((c) => c.level === 'invoice' && c.key !== 'import_ref').map((c) => c.key);
export const MAX_ROWS = 5000;
export const MAX_INVOICES = 500;

const FORMULA_PREFIX = /^[=+\-@\t\r]/;
/** Spreadsheet formula-injection protection for exported cells. */
export function safeCell(v: unknown): string | number {
  if (typeof v === 'number') return v;
  const s = v === null || v === undefined ? '' : String(v);
  return FORMULA_PREFIX.test(s) ? `'${s}` : s;
}

export async function buildTemplate(today: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'InvoiceGO';
  const ins = wb.addWorksheet('Instructions');
  ins.columns = [{ width: 28 }, { width: 14 }, { width: 12 }, { width: 90 }];
  ins.addRow(['InvoiceGO bulk invoice template']).font = { bold: true, size: 14 };
  ins.addRow(['Fill the "Invoices" sheet: one row per invoice ITEM. Rows with the same import_ref become one invoice (multiple items).']);
  ins.addRow(['Invoice-level columns (marked "invoice") must be identical on every row of the same import_ref.']);
  ins.addRow([`Only current-month dates are accepted (today in Asia/Karachi: ${today}). Others fail with: "You can't create future or previous month invoices".`]);
  ins.addRow(['Paste VALUES only — cells containing formulas are rejected. Keep code columns (NTN/CNIC, HS code) formatted as Text.']);
  ins.addRow(['Up to 500 invoices / 5,000 rows per file. After upload: preview → local validation → FBR validation → review → submit selected.']);
  ins.addRow([]);
  const h = ins.addRow(['Column', 'Required', 'Level', 'Guidance']);
  h.font = { bold: true };
  for (const c of COLUMNS) ins.addRow([c.header, c.required === true ? 'Yes' : c.required === 'conditional' ? 'Conditional' : 'No', c.level, c.note]);

  const sheet = wb.addWorksheet('Invoices', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = COLUMNS.map((c) => ({ header: c.header, key: c.key, width: Math.max(14, c.header.length + 4), style: c.text ? { numFmt: '@' } : {} }));
  sheet.getRow(1).font = { bold: true };
  const lists = wb.addWorksheet('Lists');
  lists.addRow(['invoice_type', 'buyer_registration_type']);
  lists.addRow(['Sale Invoice', 'Registered']);
  lists.addRow(['Debit Note', 'Unregistered']);
  for (let r = 2; r <= 600; r++) {
    sheet.getCell(`B${r}`).dataValidation = { type: 'list', allowBlank: true, formulae: ['Lists!$A$2:$A$3'] };
    sheet.getCell(`K${r}`).dataValidation = { type: 'list', allowBlank: true, formulae: ['Lists!$B$2:$B$3'] };
  }
  const ex = wb.addWorksheet('Example');
  ex.columns = COLUMNS.map((c) => ({ header: c.header, key: c.key, width: Math.max(14, c.header.length + 4), style: c.text ? { numFmt: '@' } : {} }));
  ex.getRow(1).font = { bold: true };
  for (let i = 0; i < 3; i++) {
    const row: Record<string, unknown> = {};
    for (const c of COLUMNS) row[c.key] = c.key === 'invoice_date' ? today : c.example[i] ?? '';
    ex.addRow(row);
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export interface RowIssue {
  importRef: string;
  row: number;
  field: string;
  level: 'error' | 'warning';
  message: string;
  scope: 'file' | 'invoice' | 'item';
}

export interface ParsedInvoice {
  importRef: string;
  rows: number[];
  input: InvoiceInput;
  issues: RowIssue[];
}

function cellText(v: ExcelJS.CellValue): { text: string; formula: boolean; numeric: boolean } {
  if (v === null || v === undefined) return { text: '', formula: false, numeric: false };
  if (typeof v === 'number') return { text: String(v), formula: false, numeric: true };
  if (typeof v === 'string') return { text: v.trim(), formula: false, numeric: false };
  if (typeof v === 'boolean') return { text: String(v), formula: false, numeric: false };
  if (v instanceof Date) {
    const iso = v.toISOString().slice(0, 10);
    return { text: iso, formula: false, numeric: false };
  }
  if (typeof v === 'object') {
    if ('formula' in v || 'sharedFormula' in v) return { text: '', formula: true, numeric: false };
    if ('richText' in v) return { text: v.richText.map((r) => r.text).join('').trim(), formula: false, numeric: false };
    if ('text' in v) return { text: String((v as { text: unknown }).text).trim(), formula: false, numeric: false };
    if ('error' in v) return { text: '', formula: true, numeric: false };
  }
  return { text: String(v).trim(), formula: false, numeric: false };
}

const DEC = /^-?\d+(\.\d+)?$/;

export async function parseWorkbook(buf: Buffer, env: 'SANDBOX' | 'PRODUCTION'): Promise<{ invoices: ParsedInvoice[]; fileIssues: RowIssue[]; totalRows: number }> {
  const wb = new ExcelJS.Workbook();
  const fileIssues: RowIssue[] = [];
  try {
    await wb.xlsx.load(buf as unknown as ExcelJS.Buffer);
  } catch {
    return { invoices: [], fileIssues: [{ importRef: '', row: 0, field: 'file', level: 'error', message: 'The file is not a readable .xlsx workbook', scope: 'file' }], totalRows: 0 };
  }
  const sheet = wb.getWorksheet('Invoices') ?? wb.worksheets[0];
  if (!sheet) return { invoices: [], fileIssues: [{ importRef: '', row: 0, field: 'file', level: 'error', message: 'No worksheet found', scope: 'file' }], totalRows: 0 };
  const header = (sheet.getRow(1).values as ExcelJS.CellValue[]).slice(1).map((v) => cellText(v).text.toLowerCase());
  const idx: Record<string, number> = {};
  header.forEach((h, i) => (idx[h] = i + 1));
  const missingCols = COLUMNS.filter((c) => c.required === true && !idx[c.key]).map((c) => c.key);
  if (missingCols.length) {
    fileIssues.push({ importRef: '', row: 1, field: 'header', level: 'error', message: `Missing required column(s): ${missingCols.join(', ')}. Download the latest template.`, scope: 'file' });
    return { invoices: [], fileIssues, totalRows: 0 };
  }
  const unknownCols = header.filter((h) => h && !COLUMNS.some((c) => c.key === h));
  if (unknownCols.length) fileIssues.push({ importRef: '', row: 1, field: 'header', level: 'warning', message: `Ignored unknown column(s): ${unknownCols.join(', ')}`, scope: 'file' });

  const groups = new Map<string, { rows: number[]; values: Record<string, string>[]; issues: RowIssue[] }>();
  let totalRows = 0;
  let lastRef = '';
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const vals: Record<string, string> = {};
    const rowIssues: RowIssue[] = [];
    let any = false;
    for (const c of COLUMNS) {
      const col = idx[c.key];
      if (!col) {
        vals[c.key] = '';
        continue;
      }
      const t = cellText(row.getCell(col).value);
      if (t.formula) rowIssues.push({ importRef: '', row: rowNumber, field: c.key, level: 'error', message: 'Formulas are not allowed — paste values only', scope: 'item' });
      if (t.numeric && (c.key === 'buyer_ntn_cnic' || c.key === 'hs_code')) {
        rowIssues.push({ importRef: '', row: rowNumber, field: c.key, level: 'error', message: `${c.key} was stored as a number, so leading zeros may have been lost. Format the column as Text and re-enter it.`, scope: c.level });
      }
      if (t.text) any = true;
      vals[c.key] = t.text;
    }
    if (!any) return;
    totalRows++;
    if (totalRows > MAX_ROWS) return;
    const ref = vals.import_ref;
    if (!ref) {
      fileIssues.push({ importRef: '', row: rowNumber, field: 'import_ref', level: 'error', message: 'import_ref is required on every row', scope: 'item' });
      return;
    }
    let g = groups.get(ref);
    if (!g) {
      g = { rows: [], values: [], issues: [] };
      groups.set(ref, g);
    } else if (lastRef !== ref) {
      g.issues.push({ importRef: ref, row: rowNumber, field: 'import_ref', level: 'warning', message: `Rows of ${ref} are not contiguous — check this is not a different invoice reusing the same reference`, scope: 'invoice' });
    }
    lastRef = ref;
    g.rows.push(rowNumber);
    g.values.push(vals);
    g.issues.push(...rowIssues.map((i) => ({ ...i, importRef: ref })));
  });
  if (totalRows > MAX_ROWS) fileIssues.push({ importRef: '', row: 0, field: 'file', level: 'error', message: `Too many rows (${totalRows}). Maximum is ${MAX_ROWS}.`, scope: 'file' });
  if (groups.size > MAX_INVOICES) fileIssues.push({ importRef: '', row: 0, field: 'file', level: 'error', message: `Too many invoices (${groups.size}). Maximum is ${MAX_INVOICES}.`, scope: 'file' });
  if (totalRows === 0) fileIssues.push({ importRef: '', row: 0, field: 'file', level: 'error', message: 'The Invoices sheet has no data rows', scope: 'file' });

  const invoices: ParsedInvoice[] = [];
  const fingerprints = new Map<string, string>();
  for (const [ref, g] of groups) {
    const issues = g.issues;
    const first = g.values[0];
    const firstRow = g.rows[0];
    const err = (row: number, field: string, message: string, scope: 'invoice' | 'item' = 'invoice') => issues.push({ importRef: ref, row, field, level: 'error', message, scope });
    // Repeated invoice-level values must be identical
    g.values.forEach((v, i) => {
      for (const k of INVOICE_LEVEL) {
        if (i > 0 && v[k] !== first[k]) err(g.rows[i], k, `${k} differs from the first row of ${ref} (row ${firstRow}): "${v[k]}" vs "${first[k]}"`);
      }
    });
    for (const c of COLUMNS.filter((c) => c.level === 'invoice' && c.required === true)) {
      if (!first[c.key]) err(firstRow, c.key, `${c.key} is required`);
    }
    const typeRaw = first.invoice_type;
    const invoiceType = /^sale invoice$/i.test(typeRaw) ? 'SALE_INVOICE' : /^debit note$/i.test(typeRaw) ? 'DEBIT_NOTE' : null;
    if (typeRaw && !invoiceType) err(firstRow, 'invoice_type', 'invoice_type must be "Sale Invoice" or "Debit Note"');
    const date = first.invoice_date;
    if (date) {
      if (!isValidIsoDate(date)) err(firstRow, 'invoice_date', 'invoice_date must be a valid date in YYYY-MM-DD format');
      else {
        const m = checkInvoiceMonth(date);
        if (!m.ok) err(firstRow, 'invoice_date', m.message);
      }
    }
    const regRaw = first.buyer_registration_type;
    const reg = /^registered$/i.test(regRaw) ? 'REGISTERED' : /^unregistered$/i.test(regRaw) ? 'UNREGISTERED' : null;
    if (regRaw && !reg) err(firstRow, 'buyer_registration_type', 'buyer_registration_type must be "Registered" or "Unregistered"');
    if (env === 'SANDBOX' && !/^SN\d{3}$/.test(first.scenario_id)) err(firstRow, 'scenario_id', 'scenario_id (SN001…SN028) is required for sandbox uploads');
    if (env === 'PRODUCTION' && first.scenario_id) issues.push({ importRef: ref, row: firstRow, field: 'scenario_id', level: 'warning', message: 'scenario_id is ignored for production submissions', scope: 'invoice' });

    const items = g.values.map((v, i) => {
      const row = g.rows[i];
      for (const c of COLUMNS.filter((c) => c.level === 'item' && c.required === true)) if (!v[c.key]) err(row, c.key, `${c.key} is required`, 'item');
      const dec = (k: string) => {
        const s = v[k].replace(/,/g, '');
        if (!s) return null;
        if (!DEC.test(s)) {
          err(row, k, `${k} must be a number`, 'item');
          return null;
        }
        return s;
      };
      if (v.hs_code && !/^\d{4}\.\d{4}$/.test(v.hs_code)) err(row, 'hs_code', 'hs_code must be in the format 0000.0000 (text)', 'item');
      const q = dec('quantity');
      if (q !== null && Number(q) <= 0) err(row, 'quantity', 'quantity must be greater than zero', 'item');
      if (q !== null && (q.split('.')[1]?.length ?? 0) > 4) err(row, 'quantity', 'quantity allows at most 4 decimals', 'item');
      return {
        productId: null,
        saleType: v.sale_type,
        hsCode: v.hs_code,
        productDescription: v.product_description,
        rate: v.tax_rate,
        uom: v.uom,
        quantity: q,
        unitPrice: dec('unit_price'),
        discount: dec('discount'),
        valueSalesExcludingST: null,
        salesTaxApplicable: dec('sales_tax'),
        retailPricePerUnit: dec('retail_price_per_unit'),
        fixedNotifiedValueOrRetailPrice: null,
        extraTax: dec('extra_tax'),
        extraTaxEmpty: false,
        furtherTax: dec('further_tax'),
        fedPayable: dec('fed_payable'),
        salesTaxWithheldAtSource: dec('st_withheld_at_source'),
        sroScheduleNo: v.sro_schedule_no,
        sroItemSerialNo: v.sro_item_serial_no,
        totalValues: null,
      };
    });
    const input: InvoiceInput = {
      invoiceType: invoiceType ?? 'SALE_INVOICE',
      invoiceDate: date,
      paymentMode: first.payment_mode || null,
      invoiceRefNo: first.invoice_ref_no,
      scenarioId: env === 'SANDBOX' && /^SN\d{3}$/.test(first.scenario_id) ? first.scenario_id : null,
      customerId: null,
      buyerNtnCnic: first.buyer_ntn_cnic,
      buyerBusinessName: first.buyer_name,
      buyerProvince: first.buyer_province,
      buyerAddress: first.buyer_address,
      buyerRegistrationType: reg,
      autoCalc: true,
      notes: null,
      items,
    };
    const fp = JSON.stringify({ d: input.invoiceDate, b: input.buyerNtnCnic || input.buyerBusinessName, i: items.map((x) => [x.hsCode, x.quantity, x.unitPrice, x.rate]) });
    const dupOf = fingerprints.get(fp);
    if (dupOf) issues.push({ importRef: ref, row: firstRow, field: 'import_ref', level: 'warning', message: `Possible duplicate of ${dupOf} in this file (same date, buyer and items)`, scope: 'invoice' });
    else fingerprints.set(fp, ref);
    invoices.push({ importRef: ref, rows: g.rows, input, issues });
  }
  return { invoices, fileIssues, totalRows };
}

export async function buildErrorReport(rows: { importRef: string; status: string; row: number | string; level: string; field: string; message: string; fbrCode?: string }[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const s = wb.addWorksheet('Errors');
  s.columns = [
    { header: 'import_ref', key: 'importRef', width: 18 },
    { header: 'status', key: 'status', width: 22 },
    { header: 'row', key: 'row', width: 8 },
    { header: 'level', key: 'level', width: 10 },
    { header: 'field', key: 'field', width: 26 },
    { header: 'fbr_code', key: 'fbrCode', width: 10 },
    { header: 'message', key: 'message', width: 100 },
  ];
  s.getRow(1).font = { bold: true };
  for (const r of rows) {
    s.addRow({
      importRef: safeCell(r.importRef),
      status: safeCell(r.status),
      row: typeof r.row === 'number' ? r.row : safeCell(r.row),
      level: safeCell(r.level),
      field: safeCell(r.field),
      fbrCode: safeCell(r.fbrCode ?? ''),
      message: safeCell(r.message),
    });
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
