import PDFDocument from 'pdfkit';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Business, Invoice, InvoiceItem } from '@prisma/client';
import { karachiParts } from '../../lib/time.js';
import { qrPng } from './qr.js';

const here = dirname(fileURLToPath(import.meta.url));
const LOGO_PATH = [join(here, '../../../assets/fbr-di-logo.png'), join(here, '../../../../assets/fbr-di-logo.png')].find(existsSync);

const fmt = (v: { toString(): string } | null | undefined, dp = 2) => {
  const n = v === null || v === undefined ? '0' : v.toString();
  const [i, f = ''] = Number(n).toFixed(dp).split('.');
  return i.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (dp ? '.' + f : '');
};

/** Renders an A4 invoice. FBR number, DI logo and QR appear only for FBR-accepted invoices. */
export async function renderInvoicePdf(inv: Invoice & { items: InvoiceItem[] }, business: Business): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 36, info: { Title: `Invoice ${inv.internalNumber}`, Producer: 'InvoiceGO' } });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((res) => doc.on('end', () => res(Buffer.concat(chunks))));

  const accepted = inv.status === 'ACCEPTED' && !!inv.fbrInvoiceNumber;
  const sandbox = inv.environment === 'SANDBOX';
  const W = doc.page.width - 72;
  const navy = '#1e2a5a';
  const muted = '#5b6475';

  // Watermark
  if (sandbox || !accepted) {
    doc.save();
    doc.rotate(-30, { origin: [300, 420] });
    doc.fontSize(46).fillColor(sandbox ? '#d64545' : '#9aa3b5').opacity(0.12);
    doc.text(sandbox ? 'SANDBOX — NOT A PRODUCTION TAX INVOICE' : 'DRAFT — NOT ISSUED BY FBR', 40, 400, { width: 560, align: 'center' });
    doc.restore();
    doc.opacity(1);
  }

  // Header
  let y = 36;
  if (business.logoData) {
    try {
      doc.image(Buffer.from(business.logoData), 36, y, { fit: [70, 50] });
    } catch {
      /* unsupported image format for pdfkit (e.g. webp) — skip */
    }
  }
  const hx = business.logoData ? 116 : 36;
  doc.fillColor(navy).font('Helvetica-Bold').fontSize(16).text(inv.sellerBusinessName, hx, y, { width: 280 });
  doc.font('Helvetica').fontSize(8.5).fillColor(muted).text(inv.sellerAddress, hx, doc.y + 2, { width: 280 });
  doc.text(`NTN/CNIC: ${inv.sellerNtnCnic}${business.strn ? `   STRN: ${business.strn}` : ''}   Province: ${inv.sellerProvince}`, hx, doc.y + 1, { width: 300 });

  const title = inv.invoiceType === 'DEBIT_NOTE' ? 'DEBIT NOTE' : 'SALES TAX INVOICE';
  doc.roundedRect(36 + W - 180, y, 180, 22, 4).fill(navy);
  doc.fillColor('#fff').font('Helvetica-Bold').fontSize(10).text(title, 36 + W - 180, y + 6, { width: 180, align: 'center' });
  doc.fillColor('#111').font('Helvetica').fontSize(8.5);
  const meta: [string, string][] = [
    ['Invoice no.', inv.internalNumber],
    ['Date', inv.invoiceDate.toISOString().slice(0, 10)],
    ['Time', inv.invoiceTime],
    ['Payment mode', inv.paymentMode ?? '—'],
    ['Environment', sandbox ? 'FBR SANDBOX' : 'FBR PRODUCTION'],
  ];
  if (inv.invoiceRefNo && inv.invoiceType === 'DEBIT_NOTE') meta.push(['Reference', inv.invoiceRefNo]);
  let my = y + 28;
  for (const [k, v] of meta) {
    doc.fillColor(muted).text(k, 36 + W - 180, my, { width: 70 });
    doc.fillColor('#111').font('Helvetica-Bold').text(v, 36 + W - 110, my, { width: 110, align: 'right' });
    doc.font('Helvetica');
    my += 11;
  }
  y = Math.max(doc.y, my) + 8;
  doc.moveTo(36, y).lineTo(36 + W, y).lineWidth(1.5).strokeColor(navy).stroke();
  y += 8;

  if (sandbox) {
    doc.roundedRect(36, y, W, 18, 3).fill('#fdecec');
    doc.fillColor('#b42318').font('Helvetica-Bold').fontSize(9).text('SANDBOX — NOT A PRODUCTION TAX INVOICE', 36, y + 5, { width: W, align: 'center' });
    y += 24;
  }
  if (!accepted) {
    doc.roundedRect(36, y, W, 18, 3).fill('#fff6e5');
    doc.fillColor('#8a5a00').font('Helvetica').fontSize(8.5).text(`Status: ${inv.status.replace(/_/g, ' ')} — not an FBR-issued invoice. No FBR invoice number or QR code is printed until FBR accepts it.`, 42, y + 5, { width: W - 12 });
    y += 24;
  }

  // Seller / buyer boxes
  const boxW = (W - 12) / 2;
  const box = (x: number, label: string, lines: [string, string][]) => {
    doc.roundedRect(x, y, boxW, 74, 4).fillAndStroke('#f5f7fb', '#dbe1ec');
    doc.fillColor('#3346a0').font('Helvetica-Bold').fontSize(8).text(label, x + 8, y + 7);
    let ly = y + 20;
    for (const [k, v] of lines) {
      doc.fillColor(muted).font('Helvetica').fontSize(8).text(k, x + 8, ly, { width: 70 });
      doc.fillColor('#111').font('Helvetica-Bold').text(v || '—', x + 80, ly, { width: boxW - 88 });
      ly += 12;
    }
  };
  box(36, 'SELLER', [
    ['Name', inv.sellerBusinessName],
    ['NTN/CNIC', inv.sellerNtnCnic],
    ['Province', inv.sellerProvince],
    ['Address', inv.sellerAddress],
  ]);
  box(36 + boxW + 12, 'BUYER', [
    ['Name', inv.buyerBusinessName],
    ['NTN/CNIC', inv.buyerNtnCnic || '—'],
    ['Province', inv.buyerProvince],
    ['Type', inv.buyerRegistrationType === 'REGISTERED' ? 'Registered' : inv.buyerRegistrationType === 'UNREGISTERED' ? 'Unregistered' : '—'],
  ]);
  y += 84;

  // Items table
  const cols = [
    { k: '#', w: 18, a: 'left' },
    { k: 'HS code', w: 52, a: 'left' },
    { k: 'Description', w: 120, a: 'left' },
    { k: 'Qty', w: 40, a: 'right' },
    { k: 'UOM', w: 46, a: 'left' },
    { k: 'Unit price', w: 52, a: 'right' },
    { k: 'Discount', w: 44, a: 'right' },
    { k: 'Value excl. ST', w: 60, a: 'right' },
    { k: 'Sales tax', w: 50, a: 'right' },
    { k: 'Total', w: W - 482, a: 'right' },
  ] as const;
  doc.rect(36, y, W, 16).fill(navy);
  let x = 36;
  doc.fillColor('#fff').font('Helvetica-Bold').fontSize(7.5);
  for (const c of cols) {
    doc.text(c.k, x + 3, y + 5, { width: c.w - 6, align: c.a });
    x += c.w;
  }
  y += 18;
  for (const it of [...inv.items].sort((a, b) => a.lineNo - b.lineNo)) {
    if (y > 700) {
      doc.addPage();
      y = 36;
    }
    const vals = [
      String(it.lineNo),
      it.hsCode,
      it.productDescription,
      fmt(it.quantity, 4).replace(/\.?0+$/, ''),
      it.uom,
      fmt(it.unitPrice),
      fmt(it.discount),
      fmt(it.valueSalesExcludingST),
      fmt(it.salesTaxApplicable),
      fmt(it.totalValues),
    ];
    x = 36;
    doc.fillColor('#111').font('Helvetica').fontSize(7.5);
    const rowTop = y;
    let rowH = 12;
    cols.forEach((c, i) => {
      const h = doc.heightOfString(vals[i], { width: c.w - 6 });
      rowH = Math.max(rowH, h + 4);
      doc.text(vals[i], x + 3, rowTop + 2, { width: c.w - 6, align: c.a });
      x += c.w;
    });
    y = rowTop + rowH;
    doc.fillColor(muted).fontSize(6.8).text(
      `Sale type: ${it.saleType} · Rate: ${it.rate} · SRO/Schedule: ${it.sroScheduleNo || '—'} · Item S.No.: ${it.sroItemSerialNo || '—'} · Retail/notified value: ${fmt(it.fixedNotifiedValueOrRetailPrice)} · Further tax: ${fmt(it.furtherTax)} · Extra tax: ${it.extraTaxEmpty ? '—' : fmt(it.extraTax)} · FED: ${fmt(it.fedPayable)} · ST withheld: ${fmt(it.salesTaxWithheldAtSource)}`,
      39,
      y,
      { width: W - 6 },
    );
    y = doc.y + 4;
    doc.moveTo(36, y).lineTo(36 + W, y).lineWidth(0.5).strokeColor('#dbe1ec').stroke();
    y += 3;
  }

  // Totals
  y += 6;
  if (y > 640) {
    doc.addPage();
    y = 36;
  }
  const tx = 36 + W - 220;
  const totals: [string, string][] = [
    ['Value excl. sales tax', fmt(inv.totalValueExclST)],
    ['Sales tax / FED in ST mode', fmt(inv.totalSalesTax)],
    ['Further tax', fmt(inv.totalFurtherTax)],
    ['Extra tax', fmt(inv.totalExtraTax)],
    ['FED payable', fmt(inv.totalFed)],
    ['Discount (included above)', fmt(inv.totalDiscount)],
  ];
  const totalsTop = y;
  for (const [k, v] of totals) {
    doc.fillColor(muted).font('Helvetica').fontSize(8.5).text(k, tx, y, { width: 130 });
    doc.fillColor('#111').text(v, tx + 130, y, { width: 90, align: 'right' });
    y += 13;
  }
  doc.rect(tx, y, 220, 22).fill(navy);
  doc.fillColor('#fff').font('Helvetica-Bold').fontSize(10).text('Grand total', tx + 8, y + 6);
  doc.text(`Rs ${fmt(inv.grandTotal)}`, tx + 90, y + 6, { width: 122, align: 'right' });
  y += 26;
  doc.fillColor(muted).font('Helvetica').fontSize(8).text(`ST withheld at source: Rs ${fmt(inv.totalWithheld)}   ·   Net receivable: Rs ${fmt(inv.netReceivable)}`, tx - 60, y, { width: 280, align: 'right' });

  // FBR block (left of totals)
  if (accepted) {
    const by = totalsTop;
    if (LOGO_PATH) doc.image(readFileSync(LOGO_PATH), 36, by, { width: 72, height: 72 });
    const qr = await qrPng(inv.fbrInvoiceNumber!, 8);
    doc.image(qr, 116, by, { width: 72, height: 72 }); // 72pt = 1.0 inch
    doc.fillColor(muted).font('Helvetica').fontSize(7.5).text('FBR invoice number', 196, by + 4);
    doc.fillColor('#111').font('Helvetica-Bold').fontSize(9.5).text(inv.fbrInvoiceNumber!, 196, by + 15, { width: 150 });
    doc.fillColor(muted).font('Helvetica').fontSize(7.5).text(`FBR timestamp: ${inv.fbrDated ?? '—'}`, 196, by + 32, { width: 150 });
    doc.text(inv.acceptedViaReconcile ? 'Recorded via reconciliation with the IRIS dashboard.' : 'Issued by FBR Digital Invoicing.', 196, by + 44, { width: 150 });
    doc.fontSize(6.5).text('QR (version 2, 1 × 1 inch) encodes the FBR invoice number; generated by InvoiceGO.', 36, by + 76, { width: 300 });
  }

  // Footer
  const now = karachiParts(new Date());
  doc.fillColor(muted).fontSize(7).text(`${inv.sellerBusinessName} · Prepared with InvoiceGO · Generated ${now.date} ${now.time} (PKT)`, 36, doc.page.height - 48, { width: W, align: 'center' });
  doc.end();
  return done;
}
