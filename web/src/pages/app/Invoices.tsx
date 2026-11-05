import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { FilePlus2 } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { dateOnly, pkr, regLabel, STATUS_LABEL, STATUS_TONE, typeLabel } from '@/lib/format';
import { Badge, Button, Card, EmptyState, EnvBadge, ErrorBanner, PageHeader, Pagination, SortTh, Spinner, Table } from '@/components/ui';

interface Row { id: string; internalNumber: string; environment: string; invoiceType: string; invoiceDate: string; buyerBusinessName: string; buyerNtnCnic: string; buyerRegistrationType: string | null; status: string; source: string; scenarioId: string | null; grandTotal: string; totalSalesTax: string; fbrInvoiceNumber: string | null }

export default function Invoices() {
  const [sp, setSp] = useSearchParams();
  const [search, setSearch] = useState(sp.get('q') ?? '');
  const f = {
    q: sp.get('q') ?? '',
    environment: sp.get('environment') ?? '',
    status: sp.get('status') ?? '',
    type: sp.get('type') ?? '',
    from: sp.get('from') ?? '',
    to: sp.get('to') ?? '',
    page: Number(sp.get('page') ?? 1),
    sort: sp.get('sort') ?? 'createdAt',
    dir: (sp.get('dir') ?? 'desc') as 'asc' | 'desc',
  };
  const set = (patch: Record<string, string | number>) => {
    const next = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) v === '' ? next.delete(k) : next.set(k, String(v));
    if (!('page' in patch)) next.set('page', '1');
    setSp(next);
  };
  const q = useQuery({ queryKey: ['invoices', f], queryFn: () => api<{ total: number; page: number; pageSize: number; rows: Row[] }>(`/api/app/invoices${qs({ ...f, pageSize: 20 })}`), placeholderData: (p) => p });
  const onSort = (field: string) => set({ sort: field, dir: f.sort === field && f.dir === 'desc' ? 'asc' : 'desc' });

  return (
    <div>
      <PageHeader title="Invoices" subtitle="All invoices, including historical months (view and report only — new invoices must be in the current month)." actions={<Link to="/app/invoices/new"><Button><FilePlus2 className="h-4 w-4" /> Create invoice</Button></Link>} />
      <Card bodyClass="p-0">
        <form className="grid gap-2 border-b border-ink-100 p-3 sm:grid-cols-2 lg:grid-cols-7" onSubmit={(e) => { e.preventDefault(); set({ q: search }); }}>
          <input className="input lg:col-span-2" placeholder="Search number, FBR number, buyer, NTN" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search invoices" />
          <select className="input" value={f.environment} onChange={(e) => set({ environment: e.target.value })} aria-label="Environment"><option value="">All environments</option><option value="PRODUCTION">Production</option><option value="SANDBOX">Sandbox</option></select>
          <select className="input" value={f.status} onChange={(e) => set({ status: e.target.value })} aria-label="Status"><option value="">All statuses</option>{Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <select className="input" value={f.type} onChange={(e) => set({ type: e.target.value })} aria-label="Type"><option value="">All types</option><option value="SALE_INVOICE">Sale Invoice</option><option value="DEBIT_NOTE">Debit Note</option></select>
          <input type="date" className="input" value={f.from} onChange={(e) => set({ from: e.target.value })} aria-label="From date" />
          <input type="date" className="input" value={f.to} onChange={(e) => set({ to: e.target.value })} aria-label="To date" />
        </form>
        {q.isLoading ? (
          <Spinner />
        ) : q.error ? (
          <div className="p-4"><ErrorBanner error={q.error} /></div>
        ) : !q.data?.rows.length ? (
          <EmptyState title="No invoices found" action={<Link to="/app/invoices/new"><Button size="sm">Create invoice</Button></Link>}>Adjust the filters or create your first invoice.</EmptyState>
        ) : (
          <>
            <Table
              head={
                <tr>
                  <SortTh label="Invoice" field="internalNumber" sort={f.sort} dir={f.dir} onSort={onSort} />
                  <SortTh label="Date" field="invoiceDate" sort={f.sort} dir={f.dir} onSort={onSort} />
                  <SortTh label="Buyer" field="buyerBusinessName" sort={f.sort} dir={f.dir} onSort={onSort} />
                  <SortTh label="Status" field="status" sort={f.sort} dir={f.dir} onSort={onSort} />
                  <th className="table-th">FBR invoice no.</th>
                  <SortTh label="Total" field="grandTotal" sort={f.sort} dir={f.dir} onSort={onSort} className="text-right" />
                </tr>
              }
            >
              {q.data.rows.map((r) => (
                <tr key={r.id} className="hover:bg-ink-50">
                  <td className="table-td">
                    <Link to={`/app/invoices/${r.id}`} className="font-medium text-brand-700 hover:underline">{r.internalNumber}</Link>
                    <div className="mt-0.5 flex flex-wrap gap-1"><EnvBadge env={r.environment} />{r.scenarioId && <Badge tone="violet">{r.scenarioId}</Badge>}<span className="text-xs text-ink-500">{typeLabel(r.invoiceType)}</span></div>
                  </td>
                  <td className="table-td whitespace-nowrap">{dateOnly(r.invoiceDate)}</td>
                  <td className="table-td">{r.buyerBusinessName}<div className="text-xs text-ink-500">{r.buyerNtnCnic || '—'} · {regLabel(r.buyerRegistrationType)}</div></td>
                  <td className="table-td"><Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status] ?? r.status}</Badge></td>
                  <td className="table-td font-mono text-xs">{r.fbrInvoiceNumber ?? '—'}</td>
                  <td className="table-td num">{pkr(r.grandTotal)}<div className="text-xs text-ink-500">ST {pkr(r.totalSalesTax, { symbol: false })}</div></td>
                </tr>
              ))}
            </Table>
            <Pagination page={f.page} pageSize={20} total={q.data.total} onPage={(p) => set({ page: p })} />
          </>
        )}
      </Card>
    </div>
  );
}
