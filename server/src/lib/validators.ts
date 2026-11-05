import { z } from 'zod';

/** Registration identifiers are always strings (leading zeros preserved). */
export const NTN_CNIC_RE = /^(\d{7}|\d{9}|\d{13})$/;

export function ntnCnicProblem(v: string | null | undefined, required: boolean): string | null {
  const s = (v ?? '').trim();
  if (!s) return required ? 'NTN/CNIC is required' : null;
  if (!/^\d+$/.test(s)) return 'NTN/CNIC must contain digits only (no dashes or spaces)';
  if (!NTN_CNIC_RE.test(s)) return 'Enter a 7-digit NTN or a 13-digit CNIC';
  return null;
}

export const BUSINESS_ACTIVITIES = [
  'Manufacturer',
  'Importer',
  'Distributor',
  'Wholesaler',
  'Exporter',
  'Retailer',
  'Service Provider',
  'Other',
] as const;

export const SECTORS = [
  'All Other Sectors',
  'Steel',
  'FMCG',
  'Textile',
  'Telecom',
  'Petroleum',
  'Electricity Distribution',
  'Gas Distribution',
  'Services',
  'Automobile',
  'CNG Stations',
  'Pharmaceuticals',
  'Wholesale / Retails',
] as const;

/**
 * Fallback province names used only until the FBR Provinces reference API (§5.1) has been
 * fetched with a real token. Not FBR data: the spec sample shows only PUNJAB and SINDH.
 */
export const FALLBACK_PROVINCES = [
  'Punjab',
  'Sindh',
  'Khyber Pakhtunkhwa',
  'Balochistan',
  'Capital Territory',
  'Gilgit Baltistan',
  'Azad Jammu and Kashmir',
];

export const PAYMENT_MODES = ['Cash', 'Bank Transfer', 'Cheque', 'Credit', 'Card', 'Online', 'Other'];

export const zTrim = (max = 300) => z.string().trim().max(max);
export const zDecimal = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .refine((v) => /^-?\d+(\.\d+)?$/.test(v), 'Must be a number');
export const zOptDecimal = z
  .union([z.string(), z.number(), z.null()])
  .optional()
  .transform((v) => (v === null || v === undefined || String(v).trim() === '' ? null : String(v).trim()))
  .refine((v) => v === null || /^-?\d+(\.\d+)?$/.test(v), 'Must be a number');
