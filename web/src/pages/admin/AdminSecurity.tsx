import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UserPlus } from 'lucide-react';
import type { AdminMe } from '@/lib/auth';
import { qs } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { Alert, Badge, Button, Card, ConfirmDialog, Dialog, EmptyState, ErrorBanner, PageHeader, Pagination, SelectInput, Spinner, Table, Tabs, TextInput, useToast } from '@/components/ui';
import { aapi, human, USER_STATUS_TONE, type AuditRow } from '@/components/admin/adminApi';

const ROLES = ['SUPER_ADMIN', 'ADMIN', 'SUPPORT', 'AUDITOR'];
const ROLE_HELP: Record<string, string> = {
  SUPER_ADMIN: 'Everything, including settings, security, user deletion and backups',
  ADMIN: 'Users, invoices, FBR monitoring & controlled retry, reports, support, announcements',
  SUPPORT: 'Read users and invoices; answer support tickets',
  AUDITOR: 'Read-only access to users, invoices, FBR logs, reports, settings and security logs',
};

interface AdminRow { id: string; name: string; email: string; role: string; status: string; mfaEnrolled: boolean; lastLoginAt: string | null; createdAt: string }
interface LoginRow { id: string; email: string; userId: string | null; success: boolean; reason: string | null; ip: string | null; userAgent: string | null; createdAt: string }
interface SessionRow { id: string; user: { email: string; name: string }; ip: string | null; userAgent: string | null; createdAt: string; lastSeenAt: string; mfaVerified: boolean }

function Admins({ me }: { me: AdminMe }) {
  const qc = useQueryClient();
  const toast = useToast();
  const canManage = me.permissions.includes('security.manage');
  const q = useQuery({ queryKey: ['admin-admins'], queryFn: () => aapi<AdminRow[]>('/security/admins') });
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteLink, setInviteLink] = useState<{ url: string; message: string } | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('ADMIN');
  const [edit, setEdit] = useState<AdminRow | null>(null);
  const [editRole, setEditRole] = useState('ADMIN');
  const [editStatus, setEditStatus] = useState('ACTIVE');
  const invite = useMutation({
    mutationFn: () => aapi<{ message: string; emailed: boolean; url?: string }>('/security/admins/invite', { body: { email, role } }),
    onSuccess: (r) => {
      if (r.emailed) toast('green', r.message);
      else if (r.url) setInviteLink({ url: r.url, message: r.message });
      setInviteOpen(false);
      setEmail('');
      void qc.invalidateQueries({ queryKey: ['admin-admins'] });
    },
  });
  const update = useMutation({
    mutationFn: () => aapi(`/security/admins/${edit!.id}/role`, { body: { role: editRole, status: editStatus } }),
    onSuccess: () => {
      toast('green', 'Administrator updated');
      setEdit(null);
      void qc.invalidateQueries({ queryKey: ['admin-admins'] });
    },
  });
  const submitInvite = (e: FormEvent) => {
    e.preventDefault();
    invite.mutate();
  };
  return (
    <Card title="Administrators" actions={canManage && <Button size="sm" onClick={() => setInviteOpen(true)}><UserPlus className="h-3.5 w-3.5" /> Invite administrator</Button>} bodyClass="p-0">
      {q.isLoading ? <Spinner /> : q.error ? <div className="p-3"><ErrorBanner error={q.error} /></div> : q.data!.length === 0 ? <EmptyState title="No administrators" /> : (
        <Table head={<tr><th className="table-th">Administrator</th><th className="table-th">Role</th><th className="table-th">Status</th><th className="table-th">2FA</th><th className="table-th">Last sign-in</th><th className="table-th"><span className="sr-only">Actions</span></th></tr>}>
          {q.data!.map((a) => (
            <tr key={a.id}>
              <td className="table-td">{a.name}{a.id === me.user.id && <span className="ml-1 text-xs text-ink-500">(you)</span>}<p className="text-xs text-ink-500">{a.email}</p></td>
              <td className="table-td"><Badge tone="violet">{human(a.role)}</Badge></td>
              <td className="table-td"><Badge tone={USER_STATUS_TONE[a.status] ?? 'gray'}>{a.status === 'INACTIVE' && !a.lastLoginAt ? 'Invited' : human(a.status)}</Badge></td>
              <td className="table-td">{a.mfaEnrolled ? <Badge tone="green">Enrolled</Badge> : <Badge tone="amber">Not enrolled</Badge>}</td>
              <td className="table-td whitespace-nowrap text-xs">{dateTime(a.lastLoginAt)}</td>
              <td className="table-td text-right">
                {canManage && a.id !== me.user.id && (
                  <Button size="sm" variant="secondary" onClick={() => { setEdit(a); setEditRole(a.role); setEditStatus(a.status === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE'); }}>
                    Edit
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </Table>
      )}
      <Dialog open={!!inviteLink} onClose={() => setInviteLink(null)} title="Deliver the invitation link" footer={<Button onClick={() => setInviteLink(null)}>Done</Button>}>
        <Alert tone="amber">{inviteLink?.message}</Alert>
        <label className="block text-xs font-medium text-ink-700" htmlFor="invite-url">One-time invitation link (valid 24 hours)</label>
        <input id="invite-url" readOnly className="input font-mono text-xs" value={inviteLink?.url ?? ''} onFocus={(e) => e.currentTarget.select()} />
        <p className="text-xs text-ink-500">Anyone with this link can set the administrator password until it is used or expires. Share it only with the invited person.</p>
      </Dialog>
      <Dialog
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        title="Invite administrator"
        footer={<><Button variant="secondary" onClick={() => setInviteOpen(false)}>Cancel</Button><Button onClick={() => invite.mutate()} loading={invite.isPending} disabled={!/^\S+@\S+\.\S+$/.test(email)}>Send invitation</Button></>}
      >
        <form onSubmit={submitInvite} className="space-y-3">
          <Alert tone="blue">The invitee receives a one-time link (valid 24 hours) to set their own password and must enrol two-factor authentication at first sign-in. No password is ever set or seen by you.</Alert>
          {invite.error && <ErrorBanner error={invite.error} />}
          <TextInput label="Email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <SelectInput label="Role" required value={role} onChange={(e) => setRole(e.target.value)} options={ROLES.map((r) => ({ value: r, label: human(r) }))} hint={ROLE_HELP[role]} />
        </form>
      </Dialog>
      <Dialog
        open={!!edit}
        onClose={() => setEdit(null)}
        title={`Edit ${edit?.name ?? 'administrator'}`}
        footer={<><Button variant="secondary" onClick={() => setEdit(null)}>Cancel</Button><Button onClick={() => update.mutate()} loading={update.isPending}>Save</Button></>}
      >
        {update.error && <ErrorBanner error={update.error} />}
        <SelectInput label="Role" value={editRole} onChange={(e) => setEditRole(e.target.value)} options={ROLES.map((r) => ({ value: r, label: human(r) }))} hint={ROLE_HELP[editRole]} />
        <SelectInput label="Status" value={editStatus} onChange={(e) => setEditStatus(e.target.value)} options={[{ value: 'ACTIVE', label: 'Active' }, { value: 'INACTIVE', label: 'Inactive (signs out all sessions)' }]} />
        <p className="text-xs text-ink-500">At least one active SUPER_ADMIN must remain.</p>
      </Dialog>
    </Card>
  );
}

function LoginHistory() {
  const [kind, setKind] = useState<'ADMIN' | 'USER'>('ADMIN');
  const q = useQuery({ queryKey: ['admin-login-history', kind], queryFn: () => aapi<LoginRow[]>(`/security/login-history${qs({ kind })}`) });
  return (
    <Card title="Login history (latest 200)" actions={<SelectInput label="Accounts" value={kind} onChange={(e) => setKind(e.target.value as 'ADMIN' | 'USER')} options={[{ value: 'ADMIN', label: 'Administrators' }, { value: 'USER', label: 'Business users' }]} className="w-48" />} bodyClass="p-0">
      {q.isLoading ? <Spinner /> : q.error ? <div className="p-3"><ErrorBanner error={q.error} /></div> : q.data!.length === 0 ? <EmptyState title="No sign-in attempts recorded" /> : (
        <Table head={<tr><th className="table-th">When</th><th className="table-th">Email</th><th className="table-th">Result</th><th className="table-th">Detail</th><th className="table-th">IP</th><th className="table-th">Device</th></tr>}>
          {q.data!.map((l) => (
            <tr key={l.id}>
              <td className="table-td whitespace-nowrap text-xs">{dateTime(l.createdAt)}</td>
              <td className="table-td text-xs">{l.email}</td>
              <td className="table-td"><Badge tone={l.success ? 'green' : 'red'}>{l.success ? 'Success' : 'Failed'}</Badge></td>
              <td className="table-td text-xs">{l.reason ?? '—'}</td>
              <td className="table-td text-xs">{l.ip ?? '—'}</td>
              <td className="table-td max-w-[260px] truncate text-xs text-ink-500" title={l.userAgent ?? ''}>{l.userAgent ?? '—'}</td>
            </tr>
          ))}
        </Table>
      )}
    </Card>
  );
}

function Sessions({ me }: { me: AdminMe }) {
  const qc = useQueryClient();
  const toast = useToast();
  const canManage = me.permissions.includes('security.manage');
  const q = useQuery({ queryKey: ['admin-sessions'], queryFn: () => aapi<SessionRow[]>('/security/sessions') });
  const [revoke, setRevoke] = useState<SessionRow | null>(null);
  const del = useMutation({
    mutationFn: (id: string) => aapi(`/security/sessions/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast('green', 'Session revoked');
      setRevoke(null);
      void qc.invalidateQueries({ queryKey: ['admin-sessions'] });
    },
  });
  return (
    <Card title="Active administrator sessions" bodyClass="p-0">
      {q.isLoading ? <Spinner /> : q.error ? <div className="p-3"><ErrorBanner error={q.error} /></div> : q.data!.length === 0 ? <EmptyState title="No active sessions" /> : (
        <Table head={<tr><th className="table-th">Administrator</th><th className="table-th">Signed in</th><th className="table-th">Last seen</th><th className="table-th">2FA</th><th className="table-th">IP / device</th><th className="table-th"><span className="sr-only">Actions</span></th></tr>}>
          {q.data!.map((s) => (
            <tr key={s.id}>
              <td className="table-td text-xs">{s.user.name}<p className="text-ink-500">{s.user.email}</p></td>
              <td className="table-td whitespace-nowrap text-xs">{dateTime(s.createdAt)}</td>
              <td className="table-td whitespace-nowrap text-xs">{dateTime(s.lastSeenAt)}</td>
              <td className="table-td">{s.mfaVerified ? <Badge tone="green">Verified</Badge> : <Badge tone="amber">Pending</Badge>}</td>
              <td className="table-td max-w-[260px] truncate text-xs text-ink-500" title={s.userAgent ?? ''}>{s.ip ?? '—'} · {s.userAgent ?? '—'}</td>
              <td className="table-td text-right">{canManage && <Button size="sm" variant="secondary" onClick={() => setRevoke(s)}>Revoke</Button>}</td>
            </tr>
          ))}
        </Table>
      )}
      <ConfirmDialog open={!!revoke} title="Revoke session" message={<>Sign out {revoke?.user.email} on this device ({revoke?.ip ?? 'unknown IP'})? Revoking your own current session signs you out.</>} confirmLabel="Revoke" danger onConfirm={() => revoke && del.mutate(revoke.id)} onClose={() => setRevoke(null)} loading={del.isPending}>
        {del.error && <ErrorBanner error={del.error} />}
      </ConfirmDialog>
    </Card>
  );
}

function AuditLog() {
  const [actorKind, setActorKind] = useState('ADMIN');
  const [actionInput, setActionInput] = useState('');
  const [action, setAction] = useState('');
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: ['admin-audit', actorKind, action, page], queryFn: () => aapi<{ total: number; rows: AuditRow[] }>(`/security/audit${qs({ actorKind, action, page })}`) });
  return (
    <div className="card">
      <form className="flex flex-wrap items-end gap-2 border-b border-ink-100 p-3" onSubmit={(e) => { e.preventDefault(); setPage(1); setAction(actionInput); }}>
        <SelectInput label="Actor" value={actorKind} onChange={(e) => { setActorKind(e.target.value); setPage(1); }} options={[{ value: 'ADMIN', label: 'Administrators' }, { value: 'USER', label: 'Business users' }, { value: 'SYSTEM', label: 'System' }, { value: '', label: 'All' }]} className="w-44" />
        <TextInput label="Action contains" placeholder="e.g. admin.user, invoice.submit" value={actionInput} onChange={(e) => setActionInput(e.target.value)} className="min-w-[220px] flex-1" />
        <Button type="submit" variant="secondary">Filter</Button>
      </form>
      {q.isLoading ? <Spinner /> : q.error ? <div className="p-3"><ErrorBanner error={q.error} /></div> : q.data!.rows.length === 0 ? <EmptyState title="No audit entries match" /> : (
        <>
          <Table head={<tr><th className="table-th">When</th><th className="table-th">Actor</th><th className="table-th">Action</th><th className="table-th">Entity</th><th className="table-th">Details</th><th className="table-th">IP</th></tr>}>
            {q.data!.rows.map((a) => (
              <tr key={a.id}>
                <td className="table-td whitespace-nowrap text-xs">{dateTime(a.createdAt)}</td>
                <td className="table-td text-xs">{human(a.actorKind)}<p className="font-mono text-[11px] text-ink-500">{a.actorUserId?.slice(0, 12) ?? '—'}</p></td>
                <td className="table-td font-mono text-xs">{a.action}</td>
                <td className="table-td text-xs">{a.entityType ?? '—'}<p className="font-mono text-[11px] text-ink-500">{a.entityId?.slice(0, 14) ?? ''}</p></td>
                <td className="table-td max-w-sm text-xs">
                  {a.metadata ? (
                    <details>
                      <summary className="cursor-pointer text-brand-700">View</summary>
                      <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-ink-50 p-2 text-[11px]">{JSON.stringify(a.metadata, null, 2)}</pre>
                    </details>
                  ) : '—'}
                </td>
                <td className="table-td text-xs">{a.ip ?? '—'}</td>
              </tr>
            ))}
          </Table>
          <Pagination page={page} pageSize={50} total={q.data!.total} onPage={setPage} />
        </>
      )}
    </div>
  );
}

export default function AdminSecurity({ me }: { me: AdminMe }) {
  const [tab, setTab] = useState('admins');
  return (
    <div className="space-y-4">
      <PageHeader title="Security" subtitle="Administrator roles, two-factor authentication, sign-in history, sessions and the administrator activity log." />
      <Tabs
        tabs={[
          { id: 'admins', label: 'Administrators & roles' },
          { id: 'logins', label: 'Login history' },
          { id: 'sessions', label: 'Sessions' },
          { id: 'audit', label: 'Activity log' },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === 'admins' && <Admins me={me} />}
      {tab === 'logins' && <LoginHistory />}
      {tab === 'sessions' && <Sessions me={me} />}
      {tab === 'audit' && <AuditLog />}
    </div>
  );
}
