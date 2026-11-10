import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, Pencil, Plus, Trash2 } from 'lucide-react';
import { api, ApiError, qs, type Issue } from '@/lib/api';
import { useHsSearch, useLineOptions } from '@/lib/fbrOptions';
import { Combobox } from '@/components/Combobox';
import { useAuth } from '@/lib/auth';
import { pkr } from '@/lib/format';
import type { Lookups, Product } from '@/lib/types';
import { Alert, Button, Card, ConfirmDialog, Dialog, EmptyState, ErrorBanner, PageHeader, Pagination, SortTh, Spinner, Table, TextInput, issueFor, useToast } from '@/components/ui';

const blank = { sku: '', description: '', hsCode: '', uom: '', saleType: '', rate: '', unitPrice: '', retailPrice: '', sroScheduleNo: '', sroItemSerialNo: '' };

export default function Products() {
  const qc = useQueryClient();
  const toast = useToast();
  const { can } = useAuth();
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState('createdAt');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  const [form, setForm] = useState<null | { id?: string; v: typeof blank }>(null);
  const [view, setView] = useState<Product | null>(null);
  const [del, setDel] = useState<Product | null>(null);
  const [hsHint, setHsHint] = useState<string | null>(null);
  const lookups = useQuery({ queryKey: ['lookups'], queryFn: () => api<Lookups>('/api/app/lookups') });
  const list = useQuery({ queryKey: ['products', search, page, sort, dir], queryFn: () => api<{ total: number; rows: Product[] }>(`/api/app/products${qs({ q: search, page, pageSize: 20, sort, dir })}`), placeholderData: (p) => p });

  const save = useMutation({
    mutationFn: (f: NonNullable<typeof form>) => api<Product & { warning: string | null }>(f.id ? `/api/app/products/${f.id}` : '/api/app/products', { method: f.id ? 'PUT' : 'POST', body: { ...f.v, rate: f.v.rate || null, retailPrice: f.v.retailPrice || null, sroScheduleNo: f.v.sroScheduleNo || null, sroItemSerialNo: f.v.sroItemSerialNo || null } }),
    onSuccess: async (p) => {
      toast(p.warning ? 'amber' : 'green', p.warning ?? `Saved ${p.sku}`);
      setForm(null);
      await qc.invalidateQueries({ queryKey: ['products'] });
      await qc.invalidateQueries({ queryKey: ['prod-all'] });
    },
  });
  const remove = useMutation({
    mutationFn: (p: Product) => api(`/api/app/products/${p.id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      setDel(null);
      toast('green', 'Product deleted');
      await qc.invalidateQueries({ queryKey: ['products'] });
    },
  });
  const issues = save.error instanceof ApiError ? save.error.issues : [];
  const onSort = (f: string) => {
    setDir(sort === f && dir === 'desc' ? 'asc' : 'desc');
    setSort(f);
  };
  const L = lookups.data;

  return (
    <div>
      <PageHeader title="Products" subtitle="Saved products autofill invoice items." actions={can('write') && <Button onClick={() => setForm({ v: blank })}><Plus className="h-4 w-4" /> Add product</Button>} />
      <Card bodyClass="p-0">
        <form className="flex flex-wrap gap-2 border-b border-ink-100 p-3" onSubmit={(e) => { e.preventDefault(); setSearch(q); setPage(1); }}>
          <input className="input max-w-md" placeholder="Search SKU, description or HS code" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search products" />
          <Button type="submit" variant="secondary">Search</Button>
        </form>
        {list.isLoading ? <Spinner /> : list.error ? <div className="p-4"><ErrorBanner error={list.error} /></div> : !list.data?.rows.length ? (
          <EmptyState title="No products yet">Add products with their HS code, UOM and sale type to speed up invoicing.</EmptyState>
        ) : (
          <>
            <Table head={<tr><SortTh label="SKU" field="sku" sort={sort} dir={dir} onSort={onSort} /><SortTh label="Description" field="description" sort={sort} dir={dir} onSort={onSort} /><SortTh label="HS code" field="hsCode" sort={sort} dir={dir} onSort={onSort} /><th className="table-th">UOM</th><th className="table-th">Sale type</th><SortTh label="Price (PKR)" field="unitPrice" sort={sort} dir={dir} onSort={onSort} className="text-right" /><th className="table-th text-right">Actions</th></tr>}>
              {list.data.rows.map((p) => (
                <tr key={p.id}>
                  <td className="table-td font-mono text-xs">{p.sku}</td>
                  <td className="table-td font-medium">{p.description}</td>
                  <td className="table-td font-mono">{p.hsCode}</td>
                  <td className="table-td text-xs">{p.uom}</td>
                  <td className="table-td text-xs">{p.saleType}{p.rate ? ` · ${p.rate}` : ''}</td>
                  <td className="table-td num">{pkr(p.unitPrice, { symbol: false })}</td>
                  <td className="table-td"><div className="flex justify-end gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setView(p)}><Eye className="h-3.5 w-3.5" /> View</Button>
                    {can('write') && <Button size="sm" variant="ghost" onClick={() => setForm({ id: p.id, v: { sku: p.sku, description: p.description, hsCode: p.hsCode, uom: p.uom, saleType: p.saleType, rate: p.rate ?? '', unitPrice: p.unitPrice, retailPrice: p.retailPrice ?? '', sroScheduleNo: p.sroScheduleNo ?? '', sroItemSerialNo: p.sroItemSerialNo ?? '' } })}><Pencil className="h-3.5 w-3.5" /> Edit</Button>}
                    {can('write') && <Button size="sm" variant="ghost" onClick={() => setDel(p)}><Trash2 className="h-3.5 w-3.5 text-red-600" /> Delete</Button>}
                  </div></td>
                </tr>
              ))}
            </Table>
            <Pagination page={page} pageSize={20} total={list.data.total} onPage={setPage} />
          </>
        )}
      </Card>

      <Dialog open={!!form} onClose={() => { setForm(null); setHsHint(null); }} title={form?.id ? 'Edit product' : 'Add product'} wide footer={<><Button variant="secondary" onClick={() => setForm(null)}>Cancel</Button><Button onClick={() => form && save.mutate(form)} loading={save.isPending}>Save</Button></>}>
        {form && (
          <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); save.mutate(form); }}>
            <div className="sm:col-span-2"><ErrorBanner error={save.error} /></div>
            <TextInput label="Product code (SKU)" required value={form.v.sku} onChange={(e) => setForm({ ...form, v: { ...form.v, sku: e.target.value } })} error={issueFor(issues, 'sku')} />
            <TextInput label="Item sale price (PKR, excl. tax)" required inputMode="decimal" value={form.v.unitPrice} onChange={(e) => setForm({ ...form, v: { ...form.v, unitPrice: e.target.value } })} error={issueFor(issues, 'unitPrice')} />
            <TextInput label="Description" required className="sm:col-span-2" value={form.v.description} onChange={(e) => setForm({ ...form, v: { ...form.v, description: e.target.value } })} error={issueFor(issues, 'description')} />
            <ProductReferenceFields v={form.v} onChange={(patch) => setForm({ ...form, v: { ...form.v, ...patch } })} issues={issues} L={L} hsHint={hsHint} onHsTyped={() => setHsHint(null)} />
            <TextInput label="Retail price / unit (3rd Schedule)" inputMode="decimal" value={form.v.retailPrice} onChange={(e) => setForm({ ...form, v: { ...form.v, retailPrice: e.target.value } })} />
            <button type="submit" className="hidden" />
          </form>
        )}
      </Dialog>
      <Dialog open={!!view} onClose={() => setView(null)} title={view ? `${view.sku} — ${view.description}` : ''}>
        {view && (
          <dl className="grid grid-cols-2 gap-2 text-sm">
            {[['HS code', view.hsCode], ['UOM', view.uom], ['Sale type', view.saleType], ['Default rate', view.rate ?? '—'], ['Sale price', pkr(view.unitPrice)], ['Retail price', view.retailPrice ? pkr(view.retailPrice) : '—'], ['SRO / schedule', view.sroScheduleNo ?? '—'], ['SRO item S. No.', view.sroItemSerialNo ?? '—']].map(([k, v]) => <div key={k} className="contents"><dt className="text-ink-500">{k}</dt><dd>{v}</dd></div>)}
          </dl>
        )}
        <Alert tone="blue">Valid UOM, rate and SRO combinations are ultimately decided by FBR reference data (HS_UOM, SaleTypeToRate, SroSchedule).</Alert>
      </Dialog>
      <ConfirmDialog open={!!del} onClose={() => setDel(null)} title="Delete product?" danger confirmLabel="Delete" loading={remove.isPending} onConfirm={() => del && remove.mutate(del)} message={<>Delete <strong>{del?.sku}</strong>? Existing invoices are not affected.</>} />
    </div>
  );
}

/** HS code, UOM, sale type, rate, SRO and SRO item as dropdowns fed by FBR's lists (fallbacks when unavailable). */
function ProductReferenceFields({ v, onChange, issues, L, hsHint, onHsTyped }: { v: typeof blank; onChange: (patch: Partial<typeof blank>) => void; issues: Issue[]; L: Lookups | undefined; hsHint: string | null; onHsTyped: () => void }) {
  const business = useQuery({ queryKey: ['business'], queryFn: () => api<{ province: string }>('/api/app/business') });
  const o = useLineOptions({ saleType: v.saleType, hsCode: v.hsCode, uom: v.uom, rate: v.rate, sroScheduleNo: v.sroScheduleNo, invoiceDate: L?.today.date ?? '', sellerProvince: business.data?.province ?? '' }, L);
  const hs = useHsSearch(v.hsCode);
  return (
    <>
      <Combobox label="HS code" required value={v.hsCode} options={hs.options} onQuery={hs.onQuery} loading={hs.loading} source="Search by code or description" placeholder="0101.2100"
        onChange={(val, opt) => { onHsTyped(); onChange({ hsCode: val.trim(), ...(opt?.description && !v.description ? { description: opt.description.slice(0, 200) } : {}) }); }}
        error={issueFor(issues, 'hsCode') ?? hsHint} hint={hs.options.find((x) => x.value === v.hsCode)?.description} />
      <Combobox label="UOM" required value={v.uom} options={o.uoms.options} source={o.uoms.source} loading={o.uoms.loading} onChange={(val) => onChange({ uom: val })} placeholder="Unit of measure"
        error={issueFor(issues, 'uom') ?? (o.uomMismatch ? `FBR expects ${o.uomMismatch.join(' or ')} for this HS code` : null)} />
      <Combobox label="Sale type" required value={v.saleType} options={o.saleTypes.options} source={o.saleTypes.source} placeholder="Choose the sale type"
        onChange={(val, opt) => onChange(opt ? { saleType: val, rate: '', sroScheduleNo: '', sroItemSerialNo: '' } : { saleType: val })} error={issueFor(issues, 'saleType')} />
      <Combobox label="Default tax rate" value={v.rate} options={o.rates.options} source={o.rates.source} loading={o.rates.loading} placeholder="e.g. 18%"
        onChange={(val, opt) => onChange(opt ? { rate: val, sroScheduleNo: '', sroItemSerialNo: '' } : { rate: val })} />
      <Combobox label="SRO / schedule no." value={v.sroScheduleNo} options={o.sros.options} source={o.sros.source} loading={o.sros.loading} placeholder="If an SRO applies"
        onChange={(val, opt) => onChange(opt ? { sroScheduleNo: val, sroItemSerialNo: '' } : { sroScheduleNo: val })} />
      <Combobox label="SRO item S. No." value={v.sroItemSerialNo} options={o.sroItems.options} source={o.sroItems.source} loading={o.sroItems.loading} placeholder="SRO item serial" onChange={(val) => onChange({ sroItemSerialNo: val })} />
      {o.fbrOff && <p className="text-xs text-ink-500 sm:col-span-2">Lists show common values. <Link to="/app/fbr" className="text-brand-700 hover:underline">Add your FBR token</Link> to get FBR’s official lists.</p>}
    </>
  );
}
