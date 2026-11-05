import { describe, expect, it } from 'vitest';
import { qrModules, qrSvg } from '../src/modules/invoices/qr';
import { DEFAULT_URLS, validateInvoiceUrl } from '../src/fbr/endpoints';

describe('QR code (spec §6: version 2, 25x25)', () => {
  it('FBR invoice numbers (22 and 28 characters) fit version 2 = 25 modules', () => {
    expect(qrModules('7000007DI1747119701593')).toBe(25);
    expect(qrModules('4130276175937DI1747119701593')).toBe(25);
  });
  it('fails instead of truncating values that do not fit version 2', () => {
    expect(() => qrModules('7'.repeat(80))).toThrow();
  });
  it('SVG generation only accepts FBR-number characters', async () => {
    await expect(qrSvg('7000007DI1747119701593')).resolves.toMatch(/<svg/);
    await expect(qrSvg('https://example.com')).rejects.toThrow();
  });
});

describe('FBR endpoint allow-list (SSRF guard)', () => {
  it('accepts the documented defaults', () => {
    expect(validateInvoiceUrl(DEFAULT_URLS.SANDBOX.postUrl, 'SANDBOX', 'post')).toBe(DEFAULT_URLS.SANDBOX.postUrl);
    expect(validateInvoiceUrl(DEFAULT_URLS.PRODUCTION.validateUrl, 'PRODUCTION', 'validate')).toBe(DEFAULT_URLS.PRODUCTION.validateUrl);
  });
  it('rejects other hosts, plain http, credentials, query strings and fragments', () => {
    expect(() => validateInvoiceUrl('https://evil.example.com/di_data/v1/di/postinvoicedata_sb', 'SANDBOX', 'post')).toThrow(/Host not allowed/);
    expect(() => validateInvoiceUrl('http://gw.fbr.gov.pk/di_data/v1/di/postinvoicedata_sb', 'SANDBOX', 'post')).toThrow();
    expect(() => validateInvoiceUrl('https://user:pw@gw.fbr.gov.pk/di_data/v1/di/postinvoicedata_sb', 'SANDBOX', 'post')).toThrow(/Credentials/);
    expect(() => validateInvoiceUrl('https://gw.fbr.gov.pk/di_data/v1/di/postinvoicedata_sb?x=1', 'SANDBOX', 'post')).toThrow(/Query/);
    expect(() => validateInvoiceUrl('https://gw.fbr.gov.pk/di_data/v1/di/postinvoicedata_sb#x', 'SANDBOX', 'post')).toThrow(/Query/);
    expect(() => validateInvoiceUrl('https://169.254.169.254/latest/meta-data', 'SANDBOX', 'post')).toThrow();
    expect(() => validateInvoiceUrl('not a url', 'SANDBOX', 'post')).toThrow();
  });
  it('keeps sandbox and production paths apart', () => {
    expect(() => validateInvoiceUrl(DEFAULT_URLS.PRODUCTION.postUrl, 'SANDBOX', 'post')).toThrow(/_sb/);
    expect(() => validateInvoiceUrl(DEFAULT_URLS.SANDBOX.postUrl, 'PRODUCTION', 'post')).toThrow();
    expect(() => validateInvoiceUrl(DEFAULT_URLS.SANDBOX.validateUrl, 'SANDBOX', 'post')).toThrow();
  });
});
