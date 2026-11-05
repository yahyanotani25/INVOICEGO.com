import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { dateTime } from '@/lib/format';
import type { Lookups } from '@/lib/types';
import { Alert, Badge, Button, Card, Checkbox, ComboInput, ErrorBanner, PageHeader, SelectInput, Spinner, Table, Tabs, TextInput, issueFor, useToast } from '@/components/ui';

interface Biz { id: string; name: string; ntnCnic: string; strn: string | null; address: string; province: string; phone: string | null; email: string | null; businessActivities: string[]; sector: string; retailerRegistered: boolean; officialScenarioIds: string[]; hasLogo: boolean; invoicePrefix: string; furtherTaxHelperRate: string | null }

export default function Settings() {
  const [tab, setTab] = useState('business');
  return (
    <div className="space-y-5">
      <PageHeader title="Settings" />
      <Tabs tabs={[{ id: 'business', label: 'Business profile' }, { id: 'account', label: 'Account & security' }, { id: 'team', label: 'Team' }]} active={tab} onChange={setTab} />
      {tab === 'business' && <BusinessTab />}
      {tab === 'account' && <AccountTab />}
      {tab === 'team' && <TeamTab />}
    </div>
  );
}

function BusinessTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const { can, refresh } = useAuth();
  const q = useQuery({ queryKey: ['business'], queryFn: () => api<Biz>('/api/app/business') });
  const lookups = useQuery({ queryKey: ['lookups'], queryFn: () => api<Lookups>('/api/app/lookups') });
  const [b, setB] = useState<Biz | null>(null);
  const [official, setOfficial] = useState('');
  const [logoV, setLogoV] = useState(0);
  useEffect(() => {
    if (q.data) {
      setB(q.data);
      setOfficial(q.data.officialScenarioIds.join(', '));
    }
  }, [q.data]);
  const save = useMutation({
    mutationFn: (x: Biz) => api<Biz>('/api/app/business', { method: 'PUT', body: { name: x.name, ntnCnic: x.ntnCnic, strn: x.strn || null, address: x.address, province: x.province, phone: x.phone || null, email: x.email || null, businessActivities: x.businessActivities, sector: x.sector, retailerRegistered: x.retailerRegistered, invoicePrefix: x.invoicePrefix, furtherTaxHelperRate: x.furtherTaxHelperRate || null } }),
    onSuccess: async () => {
      toast('green', 'Business profile saved');
      await qc.invalidateQueries({ queryKey: ['business'] });
      await qc.invalidateQueries({ queryKey: ['scenario-list'] });
      await refresh();
    },
  });
  const saveOfficial = useMutation({
    mutationFn: () => api('/api/app/business/official-scenarios', { method: 'PUT', body: { scenarioIds: official.split(/[\s,]+/).map((s) => s.trim().toUpperCase()).filter(Boolean) } }),
    onSuccess: async () => {
      toast('green', 'Official IRIS assignment saved');
      await qc.invalidateQueries({ queryKey: ['business'] });
      await qc.invalidateQueries({ queryKey: ['scenario-list'] });
    },
  });
  const logo = useMutation({
    mutationFn: (f: File) => {
      const fd = new FormData();
      fd.append('file', f);
      return api('/api/app/business/logo', { form: fd });
    },
    onSuccess: async () => {
      setLogoV((v) => v + 1);
      await qc.invalidateQueries({ queryKey: ['business'] });
    },
  });
  if (!b || !lookups.data) return <Spinner />;
  const issues = save.error instanceof ApiError ? save.error.issues : [];
  const ro = !can('manage');
  const set = (k: keyof Biz) => (e: { target: { value: string } }) => setB({ ...b, [k]: e.target.value });
  return (
    <div className="space-y-5">
      <Card title="Business details">
        <ErrorBanner error={save.error} />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <TextInput label="Business name" required value={b.name} onChange={set('name')} disabled={ro} error={issueFor(issues, 'name')} />
          <TextInput label="NTN / CNIC" required value={b.ntnCnic} onChange={set('ntnCnic')} disabled={ro} error={issueFor(issues, 'ntnCnic')} hint="Used as sellerNTNCNIC on every invoice" />
          <TextInput label="STRN" value={b.strn ?? ''} onChange={set('strn')} disabled={ro} />
          <TextInput label="Business address" required className="lg:col-span-2" value={b.address} onChange={set('address')} disabled={ro} />
          <ComboInput label="Province" required value={b.province} onChange={set('province')} suggestions={lookups.data.provinces.values} disabled={ro} />
          <TextInput label="Phone" value={b.phone ?? ''} onChange={set('phone')} disabled={ro} />
          <TextInput label="Email" type="email" value={b.email ?? ''} onChange={set('email')} disabled={ro} />
          <TextInput label="Internal invoice prefix" value={b.invoicePrefix} onChange={set('invoicePrefix')} disabled={ro} hint="Production numbering, e.g. INV-2026-000001" error={issueFor(issues, 'invoicePrefix')} />
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div>
            <p className="mb-1 text-xs font-medium text-ink-700">Business nature<span className="text-red-600">*</span> (multiple allowed)</p>
            <div className="grid grid-cols-2 gap-2">
              {lookups.data.businessActivities.map((a) => <Checkbox key={a} label={a} checked={b.businessActivities.includes(a)} onChange={(v) => !ro && setB({ ...b, businessActivities: v ? [...b.businessActivities, a] : b.businessActivities.filter((x) => x !== a) })} />)}
            </div>
          </div>
          <div className="space-y-3">
            <SelectInput label="Sector (one)" required value={b.sector} onChange={set('sector')} options={lookups.data.sectors} disabled={ro} />
            <Checkbox label="Registered as a retailer in the sales tax profile" hint="Makes SN026–SN028 applicable." checked={b.retailerRegistered} onChange={(v) => !ro && setB({ ...b, retailerRegistered: v })} />
            <TextInput label="Further-tax helper rate (%)" value={b.furtherTaxHelperRate ?? ''} onChange={set('furtherTaxHelperRate')} disabled={ro} hint="Optional. Offers a one-click further-tax suggestion for unregistered buyers in the invoice builder. Never applied automatically." error={issueFor(issues, 'furtherTaxHelperRate')} />
          </div>
        </div>
        {!ro && <div className="mt-4 text-right"><Button onClick={() => save.mutate(b)} loading={save.isPending}>Save profile</Button></div>}
      </Card>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Business logo">
          {b.hasLogo ? <img key={logoV} src={`/api/app/business/logo?v=${logoV}`} alt="Business logo" className="h-20 w-auto rounded border border-ink-200 bg-white p-1" /> : <p className="text-sm text-ink-500">No logo uploaded.</p>}
          {!ro && <div className="mt-3"><ErrorBanner error={logo.error} /><input type="file" accept="image/png,image/jpeg,image/webp" aria-label="Upload logo" className="text-sm" onChange={(e) => { const f = e.target.files?.[0]; if (f) logo.mutate(f); }} /><p className="mt-1 text-xs text-ink-500">PNG or JPEG, up to 1 MB. Printed on invoices.</p></div>}
        </Card>
        <Card title="Official scenario assignment from IRIS">
          <p className="text-sm text-ink-600">If IRIS shows a different list of required scenarios than the matrix, record it here. It then takes precedence, and the differences are shown in the sandbox workspace.</p>
          <TextInput label="Scenario IDs" value={official} onChange={(e) => setOfficial(e.target.value)} disabled={ro} placeholder="e.g. SN001, SN002, SN005" className="mt-2" />
          {!ro && <Button className="mt-2" variant="secondary" onClick={() => saveOfficial.mutate()} loading={saveOfficial.isPending}>Save assignment</Button>}
          <ErrorBanner error={saveOfficial.error} />
        </Card>
      </div>
    </div>
  );
}

function AccountTab() {
  const { me, refresh } = useAuth();
  const toast = useToast();
  const [p, setP] = useState({ name: me?.user.name ?? '', phone: me?.user.phone ?? '' });
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: () => api<{ id: string; ip: string | null; userAgent: string | null; lastSeenAt: string; current: boolean }[]>('/api/auth/sessions') });
  const history = useQuery({ queryKey: ['login-history'], queryFn: () => api<{ id: string; success: boolean; reason: string | null; ip: string | null; createdAt: string }[]>('/api/auth/login-history') });
  const prof = useMutation({ mutationFn: () => api('/api/auth/profile', { method: 'PATCH', body: p }), onSuccess: async () => { toast('green', 'Profile saved'); await refresh(); } });
  const chpw = useMutation({ mutationFn: () => api('/api/auth/change-password', { body: { currentPassword: pw.currentPassword, newPassword: pw.newPassword } }), onSuccess: () => { toast('green', 'Password changed; other sessions signed out'); setPw({ currentPassword: '', newPassword: '', confirm: '' }); sessions.refetch(); } });
  const revoke = useMutation({ mutationFn: (id: string) => api(`/api/auth/sessions/${id}`, { method: 'DELETE' }), onSuccess: () => sessions.refetch() });
  const pwIssues = chpw.error instanceof ApiError ? chpw.error.issues : [];
  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Your details">
          <ErrorBanner error={prof.error} />
          <div className="grid gap-3 sm:grid-cols-2">
            <TextInput label="Name" required value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} />
            <TextInput label="Phone" required value={p.phone} onChange={(e) => setP({ ...p, phone: e.target.value })} />
            <TextInput label="Email" value={me?.user.email ?? ''} disabled hint="Contact support to change your email" className="sm:col-span-2" />
          </div>
          <Button className="mt-3" onClick={() => prof.mutate()} loading={prof.isPending}>Save</Button>
        </Card>
        <Card title="Change password">
          <ErrorBanner error={chpw.error} />
          <div className="grid gap-3">
            <TextInput label="Current password" type="password" autoComplete="current-password" required value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} error={issueFor(pwIssues, 'currentPassword')} />
            <TextInput label="New password" type="password" autoComplete="new-password" required value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} error={issueFor(pwIssues, 'newPassword')} hint="At least 10 characters with letters and numbers" />
            <TextInput label="Confirm new password" type="password" autoComplete="new-password" required value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} error={pw.confirm && pw.confirm !== pw.newPassword ? 'Passwords do not match' : null} />
          </div>
          <Button className="mt-3" onClick={() => chpw.mutate()} loading={chpw.isPending} disabled={!pw.newPassword || pw.confirm !== pw.newPassword}>Change password</Button>
        </Card>
      </div>
      <Card title="Active sessions" bodyClass="p-0">
        <Table head={<tr><th className="table-th">Device</th><th className="table-th">IP</th><th className="table-th">Last active</th><th className="table-th" /></tr>}>
          {sessions.data?.map((s) => <tr key={s.id}><td className="table-td max-w-xs truncate text-xs">{s.userAgent}</td><td className="table-td text-xs">{s.ip}</td><td className="table-td text-xs">{dateTime(s.lastSeenAt)}</td><td className="table-td text-right">{s.current ? <Badge tone="green">This session</Badge> : <Button size="sm" variant="ghost" onClick={() => revoke.mutate(s.id)}>Sign out</Button>}</td></tr>)}
        </Table>
      </Card>
      <Card title="Login history" bodyClass="p-0">
        <Table head={<tr><th className="table-th">When</th><th className="table-th">Result</th><th className="table-th">IP</th></tr>}>
          {history.data?.map((h) => <tr key={h.id}><td className="table-td text-xs">{dateTime(h.createdAt)}</td><td className="table-td">{h.success ? <Badge tone="green">Success</Badge> : <Badge tone="red">Failed{h.reason ? ` · ${h.reason}` : ''}</Badge>}</td><td className="table-td text-xs">{h.ip}</td></tr>)}
        </Table>
      </Card>
    </div>
  );
}

function TeamTab() {
  const q = useQuery({ queryKey: ['members'], queryFn: () => api<{ id: string; role: string; name: string; email: string; status: string }[]>('/api/app/business/members') });
  return (
    <Card title="Team members" bodyClass="p-0">
      <Alert tone="blue" className="m-3">Roles: Owner and Admin manage the business and FBR credentials; Accountant and Operator create, validate and submit invoices; Viewer has read-only access.</Alert>
      <Table head={<tr><th className="table-th">Name</th><th className="table-th">Email</th><th className="table-th">Role</th><th className="table-th">Status</th></tr>}>
        {q.data?.map((m) => <tr key={m.id}><td className="table-td">{m.name}</td><td className="table-td">{m.email}</td><td className="table-td"><Badge tone="violet">{m.role}</Badge></td><td className="table-td text-xs">{m.status}</td></tr>)}
      </Table>
    </Card>
  );
}
