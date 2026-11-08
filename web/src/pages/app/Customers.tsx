import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, Pencil, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { api, ApiError, qs } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { dateTime, regLabel } from '@/lib/format';
import type { Customer, Lookups } from '@/lib/types';
import { Alert, Badge, Button, Card, Checkbox, ComboInput, ConfirmDialog, Dialog, EmptyState, ErrorBanner, PageHeader, Pagination, SelectInput, SortTh, Spinner, Table, TextInput, issueFor, useToast } from '@/components/ui';

const blank = { name: '', ntnCnic: '', strn: '', province: '', address: '', registrationType: 'UNREGISTERED' as 'REGISTERED' | 'UNREGISTERED', phone: '', email: '', category: '' };

export default function Customers() {
  const qc = useQueryClient();
  const toast = useToast();
  const { can } = useAuth();
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState('createdAt');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  const [form, setForm] = useState<null | { id?: string; v: typeof blank; allowDuplicate: boolean }>(null);
  const [view, setView] = useState<Customer | null>(null);
  const [del, setDel] = useState<Customer | null>(null);
  const [verifyMsg, setVerifyMsg] = useState<{ tone: 'green' | 'red' | 'amber'; text: string } | null>(null);
  const lookups = useQuery({ queryKey: ['lookups'], queryFn: () => api<Lookups>('/api/app/lookups') });
  const list = useQuery({ queryKey: ['customers', search, type, page, sort, dir], queryFn: () => api<{ total: number; rows: Customer[]; summary: { registered: number; unregistered: number } }>(`/api/app/customers${qs({ q: search, type, page, pageSize: 20, sort, dir })}`), placeholderData: (p) => p });

  const save = useMutation({
    mutationFn: (f: NonNullable<typeof form>) => api<Customer>(f.id ? `/api/app/customers/${f.id}` : '/api/app/customers', { method: f.id ? 'PUT' : 'POST', body: { ...f.v, allowDuplicate: f.allowDuplicate, ntnCnic: f.v.ntnCnic || null } }),
    onSuccess: async (c) => {
      toast('green', `Saved ${c.name}`);
      setForm(null);
      await qc.invalidateQueries({ queryKey: ['customers'] });
    },
  });
  const remove = useMutation({
    mutationFn: (c: Customer) => api(`/api/app/customers/${c.id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      setDel(null);
      toast('green', 'Customer deleted. Existing invoices keep their own buyer details.');
      await qc.invalidateQueries({ queryKey: ['customers'] });
    },
  });
  const verify = useMutation({
    mutationFn: (c: Customer) => api<{ customer: Customer; result: string; mismatch: boolean; message: string; activeStatus: { available: boolean; status: string | null; statusCode: string | null; message: string | null } | null }>(`/api/app/customers/${c.id}/verify`, { body: {} }),
    onSuccess: async (r) => {
      const a = r.activeStatus;
      const statl = a ? (a.available ? ` FBR active-taxpayer status (STATL) today: ${a.status ?? `code ${a.statusCode}`}.` : ` ${a.message}`) : '';
      setVerifyMsg({ tone: r.result === 'UNAVAILABLE' ? 'amber' : r.mismatch ? 'red' : 'green', text: r.message + statl });
      setView(r.customer);
      await qc.invalidateQueries({ queryKey: ['customers'] });
    },
    onError: (e) => setVerifyMsg({ tone: 'red', text: (e as Error).message }),
  });
  const issues = save.error instanceof ApiError ? save.error.issues : [];
  const onSort = (f: string) => {
    setDir(sort === f && dir === 'desc' ? 'asc' : 'desc');
    setSort(f);
  };

  return (
    <div>
      <PageHeader
        title="Customers"
        subtitle={list.data ? `${list.data.summary.registered} registered · ${list.data.summary.unregistered} unregistered buyers` : undefined}
        actions={can('write') && <Button onClick={() => setForm({ v: { ...blank, province: lookups.data?.provinces.values[0] ?? '' }, allowDuplicate: false })}><Plus className="h-4 w-4" /> Add customer</Button>}
      />
      <Card bodyClass="p-0">
        <form className="flex flex-wrap gap-2 border-b border-ink-100 p-3" onSubmit={(e) => { e.preventDefault(); setSearch(q); setPage(1); }}>
          <input className="input max-w-md" placeholder="Search name, NTN/CNIC, phone, email" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search customers" />
          <select className="input w-auto" value={type} onChange={(e) => { setType(e.target.value); setPage(1); }} aria-label="Registration type"><option value="">All types</option><option value="REGISTERED">Registered</option><option value="UNREGISTERED">Unregistered</option></select>
          <Button type="submit" variant="secondary">Search</Button>
        </form>
        {list.isLoading ? <Spinner /> : list.error ? <div className="p-4"><ErrorBanner error={list.error} /></div> : !list.data?.rows.length ? (
          <EmptyState title="No customers yet">Add buyers once and reuse them on invoices.</EmptyState>
        ) : (
          <>
            <Table head={<tr><SortTh label="Name" field="name" sort={sort} dir={dir} onSort={onSort} /><th className="table-th">NTN / CNIC</th><SortTh label="Type" field="registrationType" sort={sort} dir={dir} onSort={onSort} /><SortTh label="Province" field="province" sort={sort} dir={dir} onSort={onSort} /><th className="table-th">FBR check</th><th className="table-th text-right">Actions</th></tr>}>
              {list.data.rows.map((c) => (
                <tr key={c.id}>
                  <td className="table-td font-medium">{c.name}<div className="text-xs font-normal text-ink-500">{c.address}</div></td>
                  <td className="table-td font-mono text-xs">{c.ntnCnic ?? '—'}</td>
                  <td className="table-td"><Badge tone={c.registrationType === 'REGISTERED' ? 'violet' : 'gray'}>{regLabel(c.registrationType)}</Badge></td>
                  <td className="table-td">{c.province}</td>
                  <td className="table-td text-xs">{c.verifiedResult === 'NOT_CHECKED' ? '—' : <Badge tone={c.verifiedResult === 'UNAVAILABLE' ? 'amber' : c.verifiedResult === c.registrationType ? 'green' : 'red'}>{c.verifiedResult}</Badge>}</td>
                  <td className="table-td">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" onClick={() => { setVerifyMsg(null); setView(c); }} aria-label={`View ${c.name}`}><Eye className="h-3.5 w-3.5" /> View</Button>
                      {can('write') && <Button size="sm" variant="ghost" onClick={() => setForm({ id: c.id, v: { name: c.name, ntnCnic: c.ntnCnic ?? '', strn: c.strn ?? '', province: c.province, address: c.address, registrationType: c.registrationType, phone: c.phone ?? '', email: c.email ?? '', category: c.category ?? '' }, allowDuplicate: false })} aria-label={`Edit ${c.name}`}><Pencil className="h-3.5 w-3.5" /> Edit</Button>}
                      {can('write') && <Button size="sm" variant="ghost" onClick={() => setDel(c)} aria-label={`Delete ${c.name}`}><Trash2 className="h-3.5 w-3.5 text-red-600" /> Delete</Button>}
                    </div>
                  </td>
                </tr>
              ))}
            </Table>
            <Pagination page={page} pageSize={20} total={list.data.total} onPage={setPage} />
          </>
        )}
      </Card>

      <Dialog open={!!form} onClose={() => setForm(null)} title={form?.id ? 'Edit customer' : 'Add customer'} wide footer={<><Button variant="secondary" onClick={() => setForm(null)}>Cancel</Button><Button onClick={() => form && save.mutate(form)} loading={save.isPending}>Save</Button></>}>
        {form && (
          <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); save.mutate(form); }}>
            <div className="sm:col-span-2"><ErrorBanner error={save.error} /></div>
            <TextInput label="Customer / business name" required value={form.v.name} onChange={(e) => setForm({ ...form, v: { ...form.v, name: e.target.value } })} error={issueFor(issues, 'name')} />
            <SelectInput label="Registration" required value={form.v.registrationType} onChange={(e) => setForm({ ...form, v: { ...form.v, registrationType: e.target.value as 'REGISTERED' } })} options={[{ value: 'REGISTERED', label: 'Registered' }, { value: 'UNREGISTERED', label: 'Unregistered' }]} />
            <TextInput label="NTN / CNIC" required={form.v.registrationType === 'REGISTERED'} inputMode="numeric" value={form.v.ntnCnic} onChange={(e) => setForm({ ...form, v: { ...form.v, ntnCnic: e.target.value.trim() } })} error={issueFor(issues, 'ntnCnic')} hint="7-digit NTN or 13-digit CNIC; required for registered buyers" />
            <TextInput label="STRN" value={form.v.strn} onChange={(e) => setForm({ ...form, v: { ...form.v, strn: e.target.value } })} />
            <ComboInput label="Province" required value={form.v.province} onChange={(e) => setForm({ ...form, v: { ...form.v, province: e.target.value } })} suggestions={lookups.data?.provinces.values ?? []} error={issueFor(issues, 'province')} />
            <TextInput label="Category" value={form.v.category} onChange={(e) => setForm({ ...form, v: { ...form.v, category: e.target.value } })} placeholder="e.g. Wholesale" />
            <TextInput label="Address" required className="sm:col-span-2" value={form.v.address} onChange={(e) => setForm({ ...form, v: { ...form.v, address: e.target.value } })} error={issueFor(issues, 'address')} />
            <TextInput label="Phone" value={form.v.phone} onChange={(e) => setForm({ ...form, v: { ...form.v, phone: e.target.value } })} />
            <TextInput label="Email" type="email" value={form.v.email} onChange={(e) => setForm({ ...form, v: { ...form.v, email: e.target.value } })} error={issueFor(issues, 'email')} />
            {save.error instanceof ApiError && save.error.code === 'DUPLICATE_NTN' && <div className="sm:col-span-2"><Checkbox label="Save even if another customer has the same NTN/CNIC" checked={form.allowDuplicate} onChange={(v) => setForm({ ...form, allowDuplicate: v })} /></div>}
            <button type="submit" className="hidden" />
          </form>
        )}
      </Dialog>

      <Dialog open={!!view} onClose={() => setView(null)} title={view?.name ?? ''} footer={view && can('write') ? <Button variant="secondary" onClick={() => verify.mutate(view)} loading={verify.isPending} disabled={!view.ntnCnic}><ShieldCheck className="h-4 w-4" /> Verify registration with FBR</Button> : undefined}>
        {view && (
          <>
            <dl className="grid grid-cols-2 gap-2 text-sm">
              {[['NTN/CNIC', view.ntnCnic ?? '—'], ['STRN', view.strn ?? '—'], ['Registration', regLabel(view.registrationType)], ['Province', view.province], ['Address', view.address], ['Phone', view.phone ?? '—'], ['Email', view.email ?? '—'], ['Category', view.category ?? '—'], ['FBR verification', view.verifiedResult === 'NOT_CHECKED' ? 'Not checked' : `${view.verifiedResult} · ${dateTime(view.verifiedAt)}`]].map(([k, v]) => (
                <div key={k} className="contents"><dt className="text-ink-500">{k}</dt><dd>{v}</dd></div>
              ))}
            </dl>
            {verifyMsg && <Alert tone={verifyMsg.tone}>{verifyMsg.text}</Alert>}
          </>
        )}
      </Dialog>
      <ConfirmDialog open={!!del} onClose={() => setDel(null)} title="Delete customer?" danger confirmLabel="Delete" loading={remove.isPending} onConfirm={() => del && remove.mutate(del)} message={<>Delete <strong>{del?.name}</strong>? Invoices already created keep their own copy of the buyer details.</>} />
    </div>
  );
}
