import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { jsonToInvoiceInput, prepareTemplate } from '../src/modules/sandbox/prepare';
import { __setClock } from '../src/lib/time';

const tpl = JSON.parse(readFileSync(new URL('../data/scenario_templates.json', import.meta.url), 'utf8')) as { templates: { scenarioId: string; json: Record<string, unknown> }[] };
const T = (id: string) => tpl.templates.find((t) => t.scenarioId === id)!.json;
const seller = { ntnCnic: '1234567', name: 'Khan Traders', province: 'Punjab', address: 'Lahore' };
const MSG = "You can't create future or previous month invoices";

describe('sandbox scenario template preparation', () => {
  beforeAll(() => __setClock(() => new Date('2026-11-15T07:00:00Z')));
  afterAll(() => __setClock(null));

  it('all 28 supplied templates are present', () => {
    expect(tpl.templates.map((t) => t.scenarioId).sort()).toEqual(Array.from({ length: 28 }, (_, i) => `SN${String(i + 1).padStart(3, '0')}`));
  });

  it('replaces the sample seller, normalises the date and keeps the original untouched', () => {
    const original = JSON.parse(JSON.stringify(T('SN001')));
    const p = prepareTemplate(T('SN001'), seller, '2026-11-15');
    expect(p.prepared).toMatchObject({ sellerNTNCNIC: '1234567', sellerBusinessName: 'Khan Traders', sellerProvince: 'Punjab', sellerAddress: 'Lahore', invoiceDate: '2026-11-15', scenarioId: 'SN001' });
    expect(p.changes.map((c) => c.field)).toEqual(expect.arrayContaining(['sellerNTNCNIC', 'invoiceDate']));
    expect(p.changes.find((c) => c.field === 'invoiceDate')!.from).toBe('2025-05-10');
    expect(T('SN001')).toEqual(original);
  });

  it('converts extraTax "" to 0 with a visible change note', () => {
    const p = prepareTemplate(T('SN001'), seller, '2026-11-15');
    expect((p.prepared.items as any[])[0].extraTax).toBe(0);
    expect(p.changes.find((c) => c.field === 'items[0].extraTax')!.reason).toMatch(/0091/);
  });

  it('strips non-contract fields (SN011 dataSource, SN015 additional1-3)', () => {
    expect(prepareTemplate(T('SN011'), seller, '2026-11-15').stripped).toContain('dataSource');
    const p15 = prepareTemplate(T('SN015'), seller, '2026-11-15');
    expect(p15.stripped).toEqual(expect.arrayContaining(['additional1', 'additional2', 'additional3']));
    expect(p15.prepared).not.toHaveProperty('additional1');
  });

  it('warns that SN004 has no buyerRegistrationType instead of inventing one', () => {
    const p = prepareTemplate(T('SN004'), seller, '2026-11-15');
    expect(p.prepared.buyerRegistrationType).toBe('');
    expect(p.warnings.join(' ')).toMatch(/buyerRegistrationType/);
  });

  it('jsonToInvoiceInput validates scenario, types and the current-month rule', () => {
    const p = prepareTemplate(T('SN001'), seller, '2026-11-15').prepared;
    const ok = jsonToInvoiceInput(p, 'SN001');
    expect(ok.issues.filter((i) => i.level === 'error')).toEqual([]);
    expect(ok.input!.autoCalc).toBe(false);
    expect(ok.input!.items[0].quantity).toBe('400');

    expect(jsonToInvoiceInput(p, 'SN002').issues).toContainEqual(expect.objectContaining({ field: 'scenarioId', level: 'error' }));
    const bad = { ...p, invoiceDate: '2026-10-31', items: [{ ...(p.items as any[])[0], quantity: 'ten', hsCode: 101 }] };
    const r = jsonToInvoiceInput(bad, 'SN001');
    expect(r.issues).toContainEqual(expect.objectContaining({ field: 'invoiceDate', message: MSG }));
    expect(r.issues).toContainEqual(expect.objectContaining({ field: 'quantity', line: 1, level: 'error' }));
    expect(r.issues).toContainEqual(expect.objectContaining({ field: 'hsCode', line: 1, level: 'error' }));
    expect(jsonToInvoiceInput([], 'SN001').input).toBeNull();
  });

  it('an explicit "" extraTax in edited JSON means "send as empty"', () => {
    const p = prepareTemplate(T('SN001'), seller, '2026-11-15').prepared;
    const edited = { ...p, items: [{ ...(p.items as any[])[0], extraTax: '' }] };
    expect(jsonToInvoiceInput(edited, 'SN001').input!.items[0]).toMatchObject({ extraTaxEmpty: true, extraTax: null });
  });
});
