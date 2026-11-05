import ExcelJS from 'exceljs';
import { COLUMNS } from '../src/modules/bulk/excel';

export const TODAY = '2026-11-15';

export function row(ref: string, over: Record<string, unknown> = {}) {
  return {
    import_ref: ref, invoice_type: 'Sale Invoice', invoice_date: TODAY, payment_mode: 'Cash', invoice_ref_no: '', scenario_id: 'SN001', buyer_ntn_cnic: '0765432',
    buyer_name: `Buyer ${ref}`, buyer_province: 'Sindh', buyer_address: 'Karachi', buyer_registration_type: 'Registered', sale_type: 'Goods at standard rate (default)',
    hs_code: '0101.2100', product_description: 'Item', tax_rate: '18%', uom: 'Numbers, pieces, units', quantity: 2, unit_price: 500, discount: '', retail_price_per_unit: '',
    sales_tax: '', extra_tax: '', further_tax: '', fed_payable: '', st_withheld_at_source: '', sro_schedule_no: '', sro_item_serial_no: '', ...over,
  };
}

export async function workbook(rows: Record<string, unknown>[], opts: { dropColumn?: string; textCols?: boolean } = {}) {
  const wb = new ExcelJS.Workbook();
  const s = wb.addWorksheet('Invoices');
  const cols = COLUMNS.filter((c) => c.key !== opts.dropColumn);
  s.columns = cols.map((c) => ({ header: c.header, key: c.key, style: c.text && opts.textCols !== false ? { numFmt: '@' } : {} }));
  for (const r of rows) s.addRow(r);
  return { wb, sheet: s, buffer: async () => Buffer.from(await wb.xlsx.writeBuffer()) };
}

export function twentyFiveInvoices() {
  const rows: Record<string, unknown>[] = [];
  for (let i = 1; i <= 25; i++) {
    const ref = `INV-${String(i).padStart(3, '0')}`;
    rows.push(row(ref, { product_description: `Item A ${i}` }));
    if (i % 2 === 0) rows.push(row(ref, { product_description: `Item B ${i}`, hs_code: '1006.3090', uom: 'KG', quantity: 1.5, unit_price: 1850 }));
    if (i % 5 === 0) rows.push(row(ref, { product_description: `Item C ${i}`, quantity: 3, unit_price: 99.99, discount: 10 }));
  }
  return rows;
}

