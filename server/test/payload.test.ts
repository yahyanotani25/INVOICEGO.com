import { describe, expect, it } from 'vitest';
import { buildPayload, HEADER_KEYS, ITEM_KEYS, serializePayload, type PayloadInvoice } from '../src/fbr/payload';

const inv: PayloadInvoice = {
  invoiceType: 'SALE_INVOICE',
  invoiceDate: '2026-11-15',
  sellerNtnCnic: '0786909',
  sellerBusinessName: 'Company 8',
  sellerProvince: 'Sindh',
  sellerAddress: 'Karachi',
  buyerNtnCnic: '0012345',
  buyerBusinessName: 'Buyer',
  buyerProvince: 'Punjab',
  buyerAddress: 'Lahore',
  buyerRegistrationType: 'REGISTERED',
  invoiceRefNo: '',
  scenarioId: 'SN001',
  items: [
    {
      hsCode: '0101.2100', productDescription: 'x', rate: '18%', uom: 'Numbers, pieces, units', quantity: '1.5000', totalValues: '1180', valueSalesExcludingST: '1000',
      fixedNotifiedValueOrRetailPrice: '0', salesTaxApplicable: '180', salesTaxWithheldAtSource: '0', extraTax: '0', extraTaxEmpty: false, furtherTax: '0',
      sroScheduleNo: '', fedPayable: '0', discount: '0', saleType: 'Goods at standard rate (default)', sroItemSerialNo: '',
    },
  ],
};

describe('FBR payload serializer (contract v1.12)', () => {
  it('uses exact case-sensitive keys in contract order; scenarioId only in sandbox', () => {
    const sb = JSON.parse(serializePayload(buildPayload(inv, 'SANDBOX')));
    expect(Object.keys(sb)).toEqual([...HEADER_KEYS]);
    expect(Object.keys(sb.items[0])).toEqual([...ITEM_KEYS]);
    const prod = JSON.parse(serializePayload(buildPayload(inv, 'PRODUCTION')));
    expect(Object.keys(prod)).toEqual(HEADER_KEYS.filter((k) => k !== 'scenarioId'));
    expect(prod.scenarioId).toBeUndefined();
    expect(sb.buyerRegistrationType).toBe('Registered');
    expect(sb.invoiceType).toBe('Sale Invoice');
    expect(JSON.stringify(sb)).not.toMatch(/buyeRegistrationType|InvoiceType/);
  });

  it('never includes application-only fields', () => {
    const text = serializePayload(buildPayload({ ...inv, ...({ paymentMode: 'Cash', invoiceTime: '10:00', internalNumber: 'INV-1' } as object) } as PayloadInvoice, 'PRODUCTION'));
    expect(text).not.toMatch(/paymentMode|invoiceTime|internalNumber|retailPricePerUnit|extraTaxEmpty/);
  });

  it('emits exact decimal literals and keeps identifiers as strings', () => {
    const text = serializePayload(buildPayload(inv, 'SANDBOX'));
    expect(text).toContain('"valueSalesExcludingST": 1000.00');
    expect(text).toContain('"quantity": 1.5,');
    expect(text).toContain('"sellerNTNCNIC": "0786909"');
    expect(text).toContain('"buyerNTNCNIC": "0012345"');
    expect(text).toContain('"hsCode": "0101.2100"');
    const parsed = JSON.parse(text);
    expect(typeof parsed.items[0].salesTaxApplicable).toBe('number');
    expect(parsed.invoiceDate).toBe('2026-11-15');
  });

  it('extraTax is numeric by default and "" only when explicitly requested (error 0091)', () => {
    expect(JSON.parse(serializePayload(buildPayload(inv, 'SANDBOX'))).items[0].extraTax).toBe(0);
    const empty = { ...inv, items: [{ ...inv.items[0], extraTaxEmpty: true }] };
    expect(JSON.parse(serializePayload(buildPayload(empty, 'SANDBOX'))).items[0].extraTax).toBe('');
  });

  it('debit notes carry the reference and type wording', () => {
    const p = JSON.parse(serializePayload(buildPayload({ ...inv, invoiceType: 'DEBIT_NOTE', invoiceRefNo: '7327556DI1744111990654' }, 'PRODUCTION')));
    expect(p.invoiceType).toBe('Debit Note');
    expect(p.invoiceRefNo).toBe('7327556DI1744111990654');
  });
});
