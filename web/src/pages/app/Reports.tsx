import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { api, download, qs } from '@/lib/api';
import { dateOnly, pkr } from '@/lib/format';
import { Alert, BarChart, Button, Card, ErrorBanner, PageHeader, Spinner, Table, useToast } from '@/components/ui';

interface Rep { query: { from: string; to: string }; note: string; rows: { period: string; invoiceType: string; count: number; value: string; tax: string; further: string; extra: string; fed: string; withheld: string; total: string }[]; byRate: { rate: string; count: number; value: string; tax: string }[] }

export default function Reports() {
  const toast = useToast();
  const [f, setF] = useState({ period: 'monthly', environment: 'PRODUCTION', status: 'ACCEPTED', from: '', to: '' });
  const q = useQuery({ queryKey: ['report', f], queryFn: () => api<Rep>(`/api/app/reports/summary${qs(f)}`), placeholderData: (p) => p });
  const label = (p: string) => (f.period === 'daily' ? dateOnly(p) : f.period === 'monthly' ? p.slice(0, 7) : f.period === 'quarterly' ? `${p.slice(0, 4)} Q${Math.floor(Number(p.slice(5, 7)) / 3) + 1}` : p.slice(0, 4));
  const byPeriod = Object.values((q.data?.rows ?? []).reduce<Record<string, { label: string; value: number }>>((acc, r) => {
    const k = r.period;
    acc[k] ??= { label: label(k), value: 0 };
    acc[k].value += Number(r.value) * (r.invoiceType === 'Debit Note' ? 1 : 1);
    return acc;
  }, {}));
  return (
    <div className="space-y-5">
      <PageHeader title="Reports" subtitle="Daily, monthly, quarterly and yearly invoice values. Sandbox test values are reported separately from production." actions={<Button variant="secondary" onClick={() => download(`/api/app/reports/invoices.xlsx${qs(f)}`, 'invoices.xlsx').catch((e) => toast('red', e.message))}><Download className="h-4 w-4" /> Export Excel</Button>} />
      <Card>
        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
          <select className="input" value={f.period} onChange={(e) => setF({ ...f, period: e.target.value })} aria-label="Period"><option value="daily">Daily</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="yearly">Yearly</option></select>
          <select className="input" value={f.environment} onChange={(e) => setF({ ...f, environment: e.target.value })} aria-label="Environment"><option value="PRODUCTION">Production</option><option value="SANDBOX">Sandbox (tests)</option></select>
          <select className="input" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} aria-label="Status"><option value="ACCEPTED">Accepted by FBR only</option><option value="ALL">All statuses</option></select>
          <input type="date" className="input" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} aria-label="From" />
          <input type="date" className="input" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} aria-label="To" />
        </div>
      </Card>
      {q.isLoading ? <Spinner /> : !q.data ? <ErrorBanner error={q.error} /> : (
        <>
          <Alert tone={f.environment === 'SANDBOX' ? 'amber' : 'blue'}>{q.data.note} · {dateOnly(q.data.query.from)} – {dateOnly(q.data.query.to)}</Alert>
          <div className="grid gap-5 lg:grid-cols-2">
            <Card title="Sales value excl. ST by period"><BarChart data={byPeriod} format={(v) => pkr(v)} /></Card>
            <Card title="By tax rate" bodyClass="p-0">
              <Table head={<tr><th className="table-th">Rate</th><th className="table-th num">Lines</th><th className="table-th num">Value excl. ST</th><th className="table-th num">Sales tax</th></tr>}>
                {q.data.byRate.map((r) => <tr key={r.rate}><td className="table-td">{r.rate}</td><td className="table-td num">{r.count}</td><td className="table-td num">{pkr(r.value)}</td><td className="table-td num">{pkr(r.tax)}</td></tr>)}
              </Table>
            </Card>
          </div>
          <Card title="Period breakdown (Sale Invoice / Debit Note)" bodyClass="p-0">
            <Table head={<tr>{['Period', 'Type', 'Invoices', 'Value excl. ST', 'Sales tax', 'Further tax', 'Extra tax', 'FED', 'ST withheld', 'Gross total'].map((h, i) => <th key={h} className={`table-th ${i > 1 ? 'text-right' : ''}`}>{h}</th>)}</tr>}>
              {q.data.rows.length === 0 && <tr><td className="table-td text-center text-ink-500" colSpan={10}>No invoices in this range.</td></tr>}
              {q.data.rows.map((r) => (
                <tr key={r.period + r.invoiceType}>
                  <td className="table-td">{label(r.period)}</td><td className="table-td">{r.invoiceType}</td><td className="table-td num">{r.count}</td>
                  {[r.value, r.tax, r.further, r.extra, r.fed, r.withheld, r.total].map((v, k) => <td key={k} className="table-td num">{pkr(v, { symbol: false })}</td>)}
                </tr>
              ))}
            </Table>
          </Card>
        </>
      )}
    </div>
  );
}
