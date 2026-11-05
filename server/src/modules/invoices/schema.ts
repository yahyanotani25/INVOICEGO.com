import { z } from 'zod';
import { zOptDecimal, zTrim } from '../../lib/validators.js';

export const itemInputSchema = z.object({
  productId: z.string().optional().nullable(),
  saleType: zTrim(200),
  hsCode: zTrim(20),
  productDescription: zTrim(500),
  rate: zTrim(100),
  uom: zTrim(100),
  quantity: zOptDecimal,
  unitPrice: zOptDecimal,
  discount: zOptDecimal,
  valueSalesExcludingST: zOptDecimal,
  salesTaxApplicable: zOptDecimal,
  retailPricePerUnit: zOptDecimal,
  fixedNotifiedValueOrRetailPrice: zOptDecimal,
  extraTax: zOptDecimal,
  extraTaxEmpty: z.boolean().optional().default(false),
  furtherTax: zOptDecimal,
  fedPayable: zOptDecimal,
  salesTaxWithheldAtSource: zOptDecimal,
  sroScheduleNo: zTrim(100).optional().default(''),
  sroItemSerialNo: zTrim(100).optional().default(''),
  totalValues: zOptDecimal,
});

export const invoiceInputSchema = z.object({
  invoiceType: z.enum(['SALE_INVOICE', 'DEBIT_NOTE']).default('SALE_INVOICE'),
  invoiceDate: z.string().trim(),
  invoiceTime: z
    .string()
    .trim()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Time must be HH:mm')
    .optional(),
  paymentMode: zTrim(50).optional().nullable(),
  invoiceRefNo: zTrim(40).optional().default(''),
  scenarioId: z
    .string()
    .trim()
    .regex(/^SN\d{3}$/)
    .optional()
    .nullable(),
  customerId: z.string().optional().nullable(),
  buyerNtnCnic: zTrim(20).optional().default(''),
  buyerBusinessName: zTrim(200),
  buyerProvince: zTrim(100),
  buyerAddress: zTrim(300),
  buyerRegistrationType: z.enum(['REGISTERED', 'UNREGISTERED']).nullable(),
  autoCalc: z.boolean().optional().default(true),
  notes: zTrim(1000).optional().nullable(),
  items: z.array(itemInputSchema).min(1, 'Add at least one item').max(500),
});

export type InvoiceInput = z.infer<typeof invoiceInputSchema>;
export type ItemInputParsed = z.infer<typeof itemInputSchema>;
