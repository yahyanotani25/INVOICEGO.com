import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { dateOnly, pkr, qty, regLabel, typeLabel } from '@/lib/format';
import type { Invoice } from '@/lib/types';
import { Button, ErrorBanner, Spinner } from '@/components/ui';

/** A4 print layout. FBR number, DI logo and QR only appear once FBR has accepted the invoice. */
export default function InvoicePrint() {
  const { id } = useParams();
  const q = useQuery({ queryKey: ['invoice', id], queryFn: () => api<Invoice>(`/api/app/invoices/${id}`) });
  const biz = useQuery({ queryKey: ['business'], queryFn: () => api<{ hasLogo: boolean; strn: string | null; phone: string | null }>('/api/app/business') });
  const accepted = q.data?.status === 'ACCEPTED' && !!q.data.fbrInvoiceNumber;
  const qr = useQuery({ queryKey: ['qr', id], queryFn: async () => (await fetch(`/api/app/invoices/${id}/qr.svg`, { credentials: 'same-origin' })).text(), enabled: accepted });
  useEffect(() => {
    document.title = q.data ? `Invoice ${q.data.internalNumber}` : 'Invoice';
  }, [q.data]);
  if (q.isLoading) return <Spinner />;
  if (!q.data) return <ErrorBanner error={q.error} />;
  const inv = q.data;
  const sandbox = inv.environment === 'SANDBOX';
  return (
    <div className="min-h-screen bg-ink-100 py-6 print:bg-white print:py-0">
      <div className="no-print mx-auto mb-4 flex max-w-[210mm] justify-end gap-2 px-2">
        <Button onClick={() => window.print()}>Print / Save as PDF</Button>
      </div>
      <article className="relative mx-auto w-full max-w-[210mm] overflow-hidden bg-white p-[12mm] text-[12px] text-ink-900 shadow print:shadow-none">
        {(sandbox || !accepted) && (
          <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="-rotate-[28deg] whitespace-nowrap text-5xl font-bold uppercase tracking-wider text-red-500/10">{sandbox ? 'Sandbox — not a production tax invoice' : 'Draft — not issued by FBR'}</span>
          </div>
        )}
        <header className="flex items-start justify-between gap-4 border-b-2 border-navy pb-3">
          <div className="flex gap-3">
            {biz.data?.hasLogo && <img src="/api/app/business/logo" alt="" className="h-14 w-auto max-w-[90px] object-contain" />}
            <div>
              <h1 className="text-xl font-bold text-navy">{inv.seller.businessName}</h1>
              <p className="text-ink-600">{inv.seller.address}</p>
              <p className="text-ink-600">NTN/CNIC: {inv.seller.ntnCnic}{biz.data?.strn ? ` · STRN: ${biz.data.strn}` : ''} · {inv.seller.province}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="inline-block rounded bg-navy px-3 py-1 text-sm font-bold uppercase text-white">{inv.invoiceType === 'DEBIT_NOTE' ? 'Debit Note' : 'Sales Tax Invoice'}</p>
            <p className="mt-2">Invoice no. <strong>{inv.internalNumber}</strong></p>
            <p>Date <strong>{dateOnly(inv.invoiceDate)}</strong> · {inv.invoiceTime}</p>
            <p>Payment mode <strong>{inv.paymentMode ?? '—'}</strong></p>
            {inv.invoiceType === 'DEBIT_NOTE' && <p>Reference <strong>{inv.invoiceRefNo}</strong></p>}
            <p className="mt-1 text-[11px] font-semibold uppercase">{sandbox ? 'FBR Sandbox' : 'FBR Production'}</p>
          </div>
        </header>
        {sandbox && <p className="mt-3 rounded bg-red-50 py-1.5 text-center text-sm font-bold text-red-700">SANDBOX — NOT A PRODUCTION TAX INVOICE</p>}
        {!accepted && <p className="mt-3 rounded bg-amber-50 px-3 py-1.5 text-amber-900">Status: {typeLabel(inv.invoiceType)} {inv.status.replace(/_/g, ' ').toLowerCase()} — not an FBR-issued invoice. No FBR invoice number or QR code is printed until FBR accepts it.</p>}
        <section className="mt-4 grid grid-cols-2 gap-3">
          {[
            ['Seller', [['Name', inv.seller.businessName], ['NTN/CNIC', inv.seller.ntnCnic], ['Province', inv.seller.province], ['Address', inv.seller.address]]],
            ['Buyer', [['Name', inv.buyerBusinessName], ['NTN/CNIC', inv.buyerNtnCnic || '—'], ['Province', inv.buyerProvince], ['Address', inv.buyerAddress], ['Type', regLabel(inv.buyerRegistrationType)]]],
          ].map(([t, rows]) => (
            <div key={t as string} className="rounded border border-ink-200 bg-ink-50 p-3">
              <p className="mb-1 text-[11px] font-bold uppercase text-brand-700">{t as string}</p>
              {(rows as string[][]).map(([k, v]) => (
                <p key={k}><span className="inline-block w-20 text-ink-500">{k}</span> <strong>{v}</strong></p>
              ))}
            </div>
          ))}
        </section>
        <table className="mt-4 w-full border-collapse text-[11px]">
          <thead className="bg-navy text-white">
            <tr>{['#', 'HS code', 'Description', 'Qty', 'UOM', 'Unit price', 'Discount', 'Value excl. ST', 'Rate', 'Sales tax', 'Total'].map((h) => <th key={h} className="px-1.5 py-1.5 text-left font-semibold">{h}</th>)}</tr>
          </thead>
          <tbody>
            {inv.items.map((it) => (
              <tr key={it.id} className="border-b border-ink-200 align-top">
                <td className="px-1.5 py-1">{it.lineNo}</td>
                <td className="px-1.5 py-1 font-mono">{it.hsCode}</td>
                <td className="px-1.5 py-1">
                  {it.productDescription}
                  <div className="text-[9.5px] text-ink-500">{it.saleType} · SRO {it.sroScheduleNo || '—'} · S.No. {it.sroItemSerialNo || '—'} · Retail/notified {pkr(it.fixedNotifiedValueOrRetailPrice, { symbol: false })} · Further {pkr(it.furtherTax, { symbol: false })} · Extra {it.extraTaxEmpty ? '—' : pkr(it.extraTax, { symbol: false })} · FED {pkr(it.fedPayable, { symbol: false })} · ST withheld {pkr(it.salesTaxWithheldAtSource, { symbol: false })}{it.fbr?.itemInvoiceNo ? ` · FBR item ${it.fbr.itemInvoiceNo}` : ''}</div>
                </td>
                <td className="px-1.5 py-1 text-right">{qty(it.quantity)}</td>
                <td className="px-1.5 py-1">{it.uom}</td>
                <td className="px-1.5 py-1 text-right">{pkr(it.unitPrice, { symbol: false })}</td>
                <td className="px-1.5 py-1 text-right">{pkr(it.discount, { symbol: false })}</td>
                <td className="px-1.5 py-1 text-right">{pkr(it.valueSalesExcludingST, { symbol: false })}</td>
                <td className="px-1.5 py-1">{it.rate}</td>
                <td className="px-1.5 py-1 text-right">{pkr(it.salesTaxApplicable, { symbol: false })}</td>
                <td className="px-1.5 py-1 text-right font-semibold">{pkr(it.totalValues, { symbol: false })}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <section className="mt-4 flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            {accepted ? (
              <>
                <img src="/fbr-di-logo.png" alt="FBR Digital Invoicing System" className="h-[1in] w-[1in]" />
                <div className="h-[1in] w-[1in]" aria-label={`QR code for FBR invoice ${inv.fbrInvoiceNumber}`} dangerouslySetInnerHTML={{ __html: (qr.data ?? '').replace('<svg', '<svg width="100%" height="100%"') }} />
                <div>
                  <p className="text-[10px] text-ink-500">FBR invoice number</p>
                  <p className="font-mono text-sm font-bold">{inv.fbrInvoiceNumber}</p>
                  <p className="text-[10px] text-ink-500">FBR timestamp {inv.fbrDated ?? '—'}</p>
                  <p className="mt-1 max-w-[200px] text-[9px] text-ink-500">QR (version 2, 1 × 1 inch) encodes the FBR invoice number; generated by InvoiceGO.</p>
                </div>
              </>
            ) : (
              <p className="max-w-xs text-[11px] text-ink-500">FBR invoice number, Digital Invoicing logo and QR code are printed only after FBR accepts the invoice.</p>
            )}
          </div>
          <dl className="w-72 text-[12px]">
            {[['Value excl. sales tax', inv.totals.valueExclST], ['Sales tax / FED in ST mode', inv.totals.salesTax], ['Further tax', inv.totals.furtherTax], ['Extra tax', inv.totals.extraTax], ['FED payable', inv.totals.fed], ['Discount (included above)', inv.totals.discount]].map(([k, v]) => (
              <div key={k} className="flex justify-between py-0.5"><dt className="text-ink-600">{k}</dt><dd className="tabular-nums">{pkr(v, { symbol: false })}</dd></div>
            ))}
            <div className="mt-1 flex justify-between rounded bg-navy px-2 py-2 text-sm font-bold text-white"><dt>Grand total</dt><dd className="tabular-nums">{pkr(inv.totals.grandTotal)}</dd></div>
            <div className="flex justify-between py-0.5 text-[11px] text-ink-600"><dt>ST withheld · Net receivable</dt><dd className="tabular-nums">{pkr(inv.totals.withheld, { symbol: false })} · {pkr(inv.totals.netReceivable, { symbol: false })}</dd></div>
          </dl>
        </section>
        <footer className="mt-8 border-t border-ink-200 pt-2 text-center text-[10px] text-ink-500">{inv.seller.businessName} · Prepared with InvoiceGO · Computer-generated document</footer>
      </article>
    </div>
  );
}
