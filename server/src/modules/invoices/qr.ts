import QRCode from 'qrcode';

/**
 * Spec v1.12 §6: QR Code Version 2.0 (25×25 modules), printed at 1.0 × 1.0 inch.
 * The spec does not define the QR payload (its sample image decodes to a third-party URL and is
 * version 3 — SOURCE_CONFLICTS A7). InvoiceGO encodes exactly the FBR-issued invoice number.
 * Version 2 is forced; if the value cannot fit, generation fails — it is never truncated.
 * Error correction M holds 38 alphanumeric characters (FBR numbers are 22 or 28).
 */
const OPTS = { version: 2, errorCorrectionLevel: 'M' as const, margin: 2 };

export function assertQrValue(value: string) {
  if (!/^[0-9A-Z]+$/.test(value)) throw new Error('QR value must be an FBR invoice number (digits and capital letters)');
}

export async function qrSvg(fbrInvoiceNumber: string): Promise<string> {
  assertQrValue(fbrInvoiceNumber);
  return QRCode.toString(fbrInvoiceNumber, { ...OPTS, type: 'svg' });
}

export async function qrPng(fbrInvoiceNumber: string, pixelsPerModule = 8): Promise<Buffer> {
  assertQrValue(fbrInvoiceNumber);
  return QRCode.toBuffer(fbrInvoiceNumber, { ...OPTS, type: 'png', scale: pixelsPerModule });
}

/** Returns the module count of the generated symbol (25 for version 2) — used by tests. */
export function qrModules(value: string): number {
  return QRCode.create(value, OPTS).modules.size;
}
