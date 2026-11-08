import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { dateTime } from '@/lib/format';
import type { Lookups } from '@/lib/types';
import { Alert, Badge, Button, Card, Checkbox, ComboInput, ConfirmDialog, Dialog, ErrorBanner, PageHeader, SelectInput, Spinner, Table, Tabs, TextInput, issueFor, useToast } from '@/components/ui';

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
      <div className="grid gap-5 lg:grid-cols-2">
        <TwoFactorCard />
        <NotificationPrefsCard />
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

interface MfaStatus { enabled: boolean; enabledAt: string | null; recoveryCodesLeft: number }

function RecoveryCodes({ codes }: { codes: string[] }) {
  const toast = useToast();
  const text = codes.join('\n');
  return (
    <div className="space-y-2">
      <Alert tone="amber" title="Save these recovery codes now">Each code signs you in once if you lose your phone. They will not be shown again.</Alert>
      <pre className="grid grid-cols-2 gap-1 rounded-lg border border-ink-200 bg-ink-50 p-3 font-mono text-sm">{codes.map((c) => <span key={c}>{c}</span>)}</pre>
      <Button size="sm" variant="secondary" onClick={async () => { try { await navigator.clipboard.writeText(text); toast('green', 'Recovery codes copied'); } catch { toast('red', 'Copy failed — select and copy the codes manually'); } }}>Copy codes</Button>
    </div>
  );
}

function TwoFactorCard() {
  const qc = useQueryClient();
  const toast = useToast();
  const { refresh } = useAuth();
  const st = useQuery({ queryKey: ['mfa'], queryFn: () => api<MfaStatus>('/api/auth/mfa') });
  const [setup, setSetup] = useState<{ qrDataUrl: string; secret: string } | null>(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [disableOpen, setDisableOpen] = useState(false);
  const [dis, setDis] = useState({ password: '', code: '' });
  const [regenOpen, setRegenOpen] = useState(false);
  const [regenCode, setRegenCode] = useState('');
  const start = useMutation({ mutationFn: () => api<{ qrDataUrl: string; secret: string }>('/api/auth/mfa/setup', { body: {} }), onSuccess: (r) => { setSetup(r); setCode(''); } });
  const enable = useMutation({
    mutationFn: () => api<{ recoveryCodes: string[] }>('/api/auth/mfa/enable', { body: { code: code.trim() } }),
    onSuccess: async (r) => { setCodes(r.recoveryCodes); setSetup(null); toast('green', 'Two-factor authentication is on'); await qc.invalidateQueries({ queryKey: ['mfa'] }); await qc.invalidateQueries({ queryKey: ['sessions'] }); await refresh(); },
  });
  const disable = useMutation({
    mutationFn: () => api('/api/auth/mfa/disable', { body: { password: dis.password, code: dis.code.trim() } }),
    onSuccess: async () => { setDisableOpen(false); setDis({ password: '', code: '' }); setCodes(null); toast('green', 'Two-factor authentication is off'); await qc.invalidateQueries({ queryKey: ['mfa'] }); await refresh(); },
  });
  const regen = useMutation({
    mutationFn: () => api<{ recoveryCodes: string[] }>('/api/auth/mfa/recovery-codes', { body: { code: regenCode.trim() } }),
    onSuccess: async (r) => { setCodes(r.recoveryCodes); setRegenOpen(false); setRegenCode(''); await qc.invalidateQueries({ queryKey: ['mfa'] }); },
  });
  if (!st.data) return <Card title="Two-factor authentication"><Spinner /></Card>;
  return (
    <Card title="Two-factor authentication" actions={st.data.enabled ? <Badge tone="green">On</Badge> : <Badge tone="gray">Off</Badge>}>
      {codes && <div className="mb-4"><RecoveryCodes codes={codes} /></div>}
      {st.data.enabled ? (
        <div className="space-y-3 text-sm text-ink-600">
          <p>Signing in needs your password and a 6-digit code from your authenticator app.</p>
          <p>{st.data.recoveryCodesLeft} unused recovery code{st.data.recoveryCodesLeft === 1 ? '' : 's'} left.</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => setRegenOpen(true)}>New recovery codes</Button>
            <Button size="sm" variant="danger" onClick={() => setDisableOpen(true)}>Turn off</Button>
          </div>
        </div>
      ) : setup ? (
        <div className="space-y-3">
          <ErrorBanner error={enable.error} />
          <ol className="list-decimal space-y-1 pl-5 text-sm text-ink-600">
            <li>Open Google Authenticator, Microsoft Authenticator or 1Password on your phone.</li>
            <li>Scan this QR code, or enter the key by hand.</li>
            <li>Type the 6-digit code the app shows.</li>
          </ol>
          <img src={setup.qrDataUrl} alt="QR code for your authenticator app" className="h-44 w-44 rounded border border-ink-200 bg-white p-1" />
          <p className="break-all font-mono text-xs text-ink-500">Key: {setup.secret}</p>
          <TextInput label="6-digit code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} />
          <div className="flex gap-2">
            <Button onClick={() => enable.mutate()} loading={enable.isPending} disabled={code.length !== 6}>Turn on</Button>
            <Button variant="ghost" onClick={() => setSetup(null)}>Cancel</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3 text-sm text-ink-600">
          <p>Protect your account with a code from your phone in addition to your password. Recommended for owners and admins, who manage FBR tokens.</p>
          <ErrorBanner error={start.error} />
          <Button onClick={() => start.mutate()} loading={start.isPending}>Set up two-factor authentication</Button>
        </div>
      )}
      <Dialog open={disableOpen} onClose={() => setDisableOpen(false)} title="Turn off two-factor authentication" footer={<><Button variant="ghost" onClick={() => setDisableOpen(false)}>Cancel</Button><Button variant="danger" onClick={() => disable.mutate()} loading={disable.isPending} disabled={!dis.password || dis.code.trim().length < 6}>Turn off</Button></>}>
        <div className="space-y-3">
          <ErrorBanner error={disable.error} />
          <TextInput label="Password" type="password" autoComplete="current-password" value={dis.password} onChange={(e) => setDis({ ...dis, password: e.target.value })} />
          <TextInput label="Authentication code or recovery code" autoComplete="one-time-code" value={dis.code} onChange={(e) => setDis({ ...dis, code: e.target.value })} />
        </div>
      </Dialog>
      <Dialog open={regenOpen} onClose={() => setRegenOpen(false)} title="New recovery codes" footer={<><Button variant="ghost" onClick={() => setRegenOpen(false)}>Cancel</Button><Button onClick={() => regen.mutate()} loading={regen.isPending} disabled={regenCode.length !== 6}>Create new codes</Button></>}>
        <div className="space-y-3">
          <p className="text-sm text-ink-600">Your old recovery codes stop working.</p>
          <ErrorBanner error={regen.error} />
          <TextInput label="6-digit code from your app" inputMode="numeric" value={regenCode} onChange={(e) => setRegenCode(e.target.value.replace(/\D/g, '').slice(0, 6))} />
        </div>
      </Dialog>
    </Card>
  );
}

function NotificationPrefsCard() {
  const { me, refresh } = useAuth();
  const toast = useToast();
  const save = useMutation({ mutationFn: (v: boolean) => api('/api/auth/preferences', { method: 'PATCH', body: { emailNotifications: v } }), onSuccess: async (_r, v) => { toast('green', v ? 'Email notifications on' : 'Email notifications off'); await refresh(); } });
  const on = me?.user.emailNotifications ?? true;
  return (
    <Card title="Email notifications">
      <ErrorBanner error={save.error} />
      <Checkbox
        label="Email me about rejected or uncertain FBR submissions, support replies, team changes and announcements"
        hint="Notifications always appear in the app. Security emails (password reset, sign-in codes) are always sent."
        checked={on}
        onChange={(v) => !save.isPending && save.mutate(v)}
      />
    </Card>
  );
}

interface TeamMember { id: string; userId: string; name: string; email: string; role: string; status: string; mfaEnabled: boolean; joinedAt: string; isYou: boolean; canChange: boolean }
interface TeamInvite { id: string; email: string; role: string; state: string; createdAt: string; expiresAt: string; invitedBy: string | null; canChange: boolean }
interface Team { yourRole: string; canManage: boolean; assignableRoles: string[]; roleDescriptions: Record<string, string>; members: TeamMember[]; invites: TeamInvite[] }
const roleLabel = (r: string) => r.charAt(0) + r.slice(1).toLowerCase();

function InviteLink({ url, onClose }: { url: string; onClose: () => void }) {
  const toast = useToast();
  return (
    <Dialog open onClose={onClose} title="Share the invitation link" footer={<Button onClick={onClose}>Done</Button>}>
      <div className="space-y-3">
        <Alert tone="amber">The invitation email could not be sent. Send this link to the person yourself (for example by WhatsApp). It works once and expires in 7 days.</Alert>
        <TextInput label="Invitation link" readOnly value={url} onFocus={(e) => e.target.select()} />
        <Button size="sm" variant="secondary" onClick={async () => { try { await navigator.clipboard.writeText(url); toast('green', 'Link copied'); } catch { toast('red', 'Copy failed — select the link and copy it'); } }}>Copy link</Button>
      </div>
    </Dialog>
  );
}

function TeamTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const nav = useNavigate();
  const { refresh } = useAuth();
  const q = useQuery({ queryKey: ['team'], queryFn: () => api<Team>('/api/app/team') });
  const [inv, setInv] = useState({ email: '', role: '' });
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [removeM, setRemoveM] = useState<TeamMember | null>(null);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const reload = () => qc.invalidateQueries({ queryKey: ['team'] });
  const invite = useMutation({
    mutationFn: () => api<{ emailed: boolean; url?: string }>('/api/app/team/invites', { body: { email: inv.email.trim(), role: inv.role } }),
    onSuccess: async (r) => { if (r.emailed) toast('green', `Invitation sent to ${inv.email.trim()}`); else if (r.url) setShareUrl(r.url); setInv({ email: '', role: inv.role }); await reload(); },
  });
  const resend = useMutation({ mutationFn: (id: string) => api<{ emailed: boolean; url?: string }>(`/api/app/team/invites/${id}/resend`, { body: {} }), onSuccess: async (r) => { if (r.emailed) toast('green', 'Invitation sent again'); else if (r.url) setShareUrl(r.url); await reload(); } });
  const revoke = useMutation({ mutationFn: (id: string) => api(`/api/app/team/invites/${id}`, { method: 'DELETE' }), onSuccess: async () => { toast('green', 'Invitation revoked'); await reload(); } });
  const changeRole = useMutation({ mutationFn: (v: { id: string; role: string }) => api(`/api/app/team/members/${v.id}`, { method: 'PATCH', body: { role: v.role } }), onSuccess: async () => { toast('green', 'Role updated'); await reload(); } });
  const remove = useMutation({ mutationFn: (id: string) => api(`/api/app/team/members/${id}`, { method: 'DELETE' }), onSuccess: async () => { setRemoveM(null); toast('green', 'Member removed'); await reload(); } });
  const leave = useMutation({ mutationFn: () => api('/api/app/team/leave', { body: {} }), onSuccess: async () => { setLeaveOpen(false); qc.removeQueries({ predicate: (query) => query.queryKey[0] !== 'me' }); await refresh(); nav('/app', { replace: true }); } });
  if (!q.data) return q.error ? <ErrorBanner error={q.error} /> : <Spinner />;
  const t = q.data;
  const inviteIssues = invite.error instanceof ApiError ? invite.error.issues : [];
  const roleOptions = t.assignableRoles.map((r) => ({ value: r, label: roleLabel(r) }));
  return (
    <div className="space-y-5">
      {t.canManage && (
        <Card title="Invite a team member">
          <ErrorBanner error={invite.error} />
          <form className="grid gap-3 sm:grid-cols-[1fr_12rem_auto] sm:items-end" onSubmit={(e) => { e.preventDefault(); invite.mutate(); }}>
            <TextInput label="Email address" type="email" required value={inv.email} onChange={(e) => setInv({ ...inv, email: e.target.value })} error={issueFor(inviteIssues, 'email')} />
            <SelectInput label="Role" required value={inv.role} onChange={(e) => setInv({ ...inv, role: e.target.value })} options={roleOptions} placeholder="Choose a role" />
            <Button type="submit" loading={invite.isPending} disabled={!inv.email.trim() || !inv.role}>Send invitation</Button>
          </form>
          {inv.role && <p className="mt-2 text-xs text-ink-500">{t.roleDescriptions[inv.role]}.</p>}
        </Card>
      )}
      <Card title="Team members" bodyClass="p-0">
        <Table head={<tr><th className="table-th">Name</th><th className="table-th">Email</th><th className="table-th">Role</th><th className="table-th">2FA</th><th className="table-th">Joined</th><th className="table-th" /></tr>}>
          {t.members.map((m) => (
            <tr key={m.id}>
              <td className="table-td">{m.name}{m.isYou && <span className="ml-1 text-xs text-ink-500">(you)</span>}</td>
              <td className="table-td text-xs">{m.email}</td>
              <td className="table-td">
                {m.canChange ? (
                  <select aria-label={`Role for ${m.name}`} className="input py-1 text-sm" value={m.role} disabled={changeRole.isPending} onChange={(e) => changeRole.mutate({ id: m.id, role: e.target.value })}>
                    {[m.role, ...t.assignableRoles.filter((r) => r !== m.role)].map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
                  </select>
                ) : <Badge tone="violet">{roleLabel(m.role)}</Badge>}
              </td>
              <td className="table-td">{m.mfaEnabled ? <Badge tone="green">On</Badge> : <span className="text-xs text-ink-400">Off</span>}</td>
              <td className="table-td text-xs">{dateTime(m.joinedAt)}</td>
              <td className="table-td text-right">{m.canChange && <Button size="sm" variant="ghost" onClick={() => setRemoveM(m)}>Remove</Button>}</td>
            </tr>
          ))}
        </Table>
        <ErrorBanner error={changeRole.error} />
      </Card>
      {t.canManage && (
        <Card title="Pending invitations" bodyClass="p-0">
          {t.invites.length === 0 ? <p className="p-4 text-sm text-ink-500">No pending invitations.</p> : (
            <Table head={<tr><th className="table-th">Email</th><th className="table-th">Role</th><th className="table-th">Invited by</th><th className="table-th">Expires</th><th className="table-th" /></tr>}>
              {t.invites.map((i) => (
                <tr key={i.id}>
                  <td className="table-td text-xs">{i.email}</td>
                  <td className="table-td"><Badge tone="violet">{roleLabel(i.role)}</Badge></td>
                  <td className="table-td text-xs">{i.invitedBy ?? '—'}</td>
                  <td className="table-td text-xs">{i.state === 'EXPIRED' ? <Badge tone="amber">Expired</Badge> : dateTime(i.expiresAt)}</td>
                  <td className="table-td text-right">
                    {i.canChange && (
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => resend.mutate(i.id)} loading={resend.isPending && resend.variables === i.id}>{i.state === 'EXPIRED' ? 'Send new link' : 'Resend'}</Button>
                        <Button size="sm" variant="ghost" onClick={() => revoke.mutate(i.id)} loading={revoke.isPending && revoke.variables === i.id}>Revoke</Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </Table>
          )}
          <ErrorBanner error={resend.error ?? revoke.error} />
        </Card>
      )}
      <Card title="Roles">
        <ul className="space-y-1 text-sm text-ink-600">{Object.entries(t.roleDescriptions).map(([r, d]) => <li key={r}>{d}.</li>)}</ul>
        {t.yourRole !== 'OWNER' && <Button className="mt-4" variant="secondary" onClick={() => setLeaveOpen(true)}>Leave this business</Button>}
      </Card>
      {shareUrl && <InviteLink url={shareUrl} onClose={() => setShareUrl(null)} />}
      <ConfirmDialog open={!!removeM} title="Remove team member" message={<>Remove <strong>{removeM?.name}</strong> ({removeM?.email}) from this business? They lose access immediately. Invoices they created are kept.</>} confirmLabel="Remove" danger loading={remove.isPending} onConfirm={() => removeM && remove.mutate(removeM.id)} onClose={() => setRemoveM(null)}>
        <ErrorBanner error={remove.error} />
      </ConfirmDialog>
      <ConfirmDialog open={leaveOpen} title="Leave this business" message="You will lose access to this business’s invoices and settings. The owner can invite you again later." confirmLabel="Leave" danger loading={leave.isPending} onConfirm={() => leave.mutate()} onClose={() => setLeaveOpen(false)}>
        <ErrorBanner error={leave.error} />
      </ConfirmDialog>
    </div>
  );
}
