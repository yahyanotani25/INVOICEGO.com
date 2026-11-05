import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { buildErrorReport, buildTemplate, parseWorkbook, safeCell } from '../src/modules/bulk/excel';
import { row, TODAY, twentyFiveInvoices, workbook } from './excelFixtures';
import { __setClock } from '../src/lib/time';

const MSG = "You can't create future or previous month invoices";

describe('Excel bulk parsing', () => {
  beforeAll(() => __setClock(() => new Date('2026-11-15T07:00:00Z')));
  afterAll(() => __setClock(null));

  it('groups >= 20 multi-line invoices by import_ref', async () => {
    const rows = twentyFiveInvoices();
    const { buffer } = await workbook(rows);
    const r = await parseWorkbook(await buffer(), 'SANDBOX');
    expect(r.fileIssues.filter((i) => i.level === 'error')).toEqual([]);
    expect(r.invoices).toHaveLength(25);
    expect(r.totalRows).toBe(rows.length);
    const inv10 = r.invoices.find((i) => i.importRef === 'INV-010')!;
    expect(inv10.input.items).toHaveLength(3);
    expect(inv10.rows).toHaveLength(3);
    expect(inv10.input.buyerNtnCnic).toBe('0765432');
    expect(inv10.input.items[1]).toMatchObject({ hsCode: '1006.3090', quantity: '1.5', unitPrice: '1850' });
    expect(r.invoices.every((i) => i.issues.filter((x) => x.level === 'error').length === 0)).toBe(true);
  });

  it('flags repeated-header mismatches with the row number', async () => {
    const { buffer } = await workbook([row('A1'), row('A1', { buyer_name: 'Someone else' })]);
    const r = await parseWorkbook(await buffer(), 'SANDBOX');
    expect(r.invoices[0].issues).toContainEqual(expect.objectContaining({ row: 3, field: 'buyer_name', level: 'error' }));
  });

  it('rejects formulas, numeric NTN cells, bad HS codes and previous-month dates', async () => {
    const { sheet, buffer } = await workbook([row('F1'), row('N1'), row('H1', { hs_code: '101.21' }), row('D1', { invoice_date: '2026-10-31' }), row('X1', { invoice_date: '2026-12-01' })], { textCols: false });
    sheet.getCell('Q2').value = { formula: '1+1', result: 2 } as ExcelJS.CellFormulaValue; // quantity
    sheet.getCell('G3').value = 765432; // buyer_ntn_cnic stored as a number (leading zero lost)
    const r = await parseWorkbook(await buffer(), 'SANDBOX');
    const by = (ref: string) => r.invoices.find((i) => i.importRef === ref)!.issues;
    expect(by('F1')).toContainEqual(expect.objectContaining({ field: 'quantity', message: expect.stringMatching(/Formulas are not allowed/) }));
    expect(by('N1')).toContainEqual(expect.objectContaining({ field: 'buyer_ntn_cnic', message: expect.stringMatching(/leading zeros/) }));
    expect(by('H1')).toContainEqual(expect.objectContaining({ field: 'hs_code', row: 4 }));
    expect(by('D1')).toContainEqual(expect.objectContaining({ field: 'invoice_date', message: MSG, row: 5 }));
    expect(by('X1')).toContainEqual(expect.objectContaining({ field: 'invoice_date', message: MSG }));
  });

  it('reports a missing required column', async () => {
    const { buffer } = await workbook([row('M1')], { dropColumn: 'hs_code' });
    const r = await parseWorkbook(await buffer(), 'SANDBOX');
    expect(r.fileIssues[0].message).toMatch(/Missing required column\(s\): hs_code/);
  });

  it('requires scenario_id for sandbox uploads', async () => {
    const { buffer } = await workbook([row('S1', { scenario_id: '' })]);
    const r = await parseWorkbook(await buffer(), 'SANDBOX');
    expect(r.invoices[0].issues).toContainEqual(expect.objectContaining({ field: 'scenario_id', level: 'error' }));
  });

  it('the downloadable template round-trips (Example rows parse cleanly)', async () => {
    const tpl = new ExcelJS.Workbook();
    await tpl.xlsx.load((await buildTemplate(TODAY)) as never);
    expect(tpl.worksheets.map((w) => w.name)).toEqual(['Instructions', 'Invoices', 'Lists', 'Example']);
    const ex = tpl.getWorksheet('Example')!;
    const inv = tpl.getWorksheet('Invoices')!;
    ex.eachRow((r, n) => {
      if (n > 1) inv.getRow(n).values = r.values as ExcelJS.CellValue[];
    });
    const r = await parseWorkbook(Buffer.from(await tpl.xlsx.writeBuffer()), 'SANDBOX');
    expect(r.invoices.map((i) => [i.importRef, i.input.items.length])).toEqual([['INV-1001', 2], ['INV-1002', 1]]);
    expect(r.invoices.flatMap((i) => i.issues).filter((i) => i.level === 'error')).toEqual([]);
  });

  it('neutralises spreadsheet formula injection in exported reports', async () => {
    expect(safeCell('=cmd|"/c calc"!A1')).toBe("'=cmd|\"/c calc\"!A1");
    expect(safeCell('+1')).toBe("'+1");
    expect(safeCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(safeCell('Normal')).toBe('Normal');
    expect(safeCell(12.5)).toBe(12.5);
    const buf = await buildErrorReport([{ importRef: '=HYPERLINK("x")', status: 'X', row: 2, level: 'error', field: 'f', message: '-2+3' }]);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as never);
    const r2 = wb.getWorksheet('Errors')!.getRow(2);
    expect(r2.getCell(1).value).toBe('\'=HYPERLINK("x")');
    expect(r2.getCell(7).value).toBe("'-2+3");
  });
});
