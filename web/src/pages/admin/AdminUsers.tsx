import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, KeyRound, Search, Trash2, UserCog } from 'lucide-react';
import type { AdminMe } from '@/lib/auth';
import { qs } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { Alert, Badge, Button, Card, ConfirmDialog, Dialog, EmptyState, ErrorBanner, PageHeader, Pagination, SelectInput, Spinner, Table, TextArea, TextInput, useToast } from '@/components/ui';
import { aapi, human, USER_STATUS_TONE } from '@/components/admin/adminApi';

interface UserRow {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  status: string;
  createdAt: string;
  lastLoginAt: string | null;
  businesses: { id: string; name: string; ntnCnic: string; strn: string | null; role: string }[];
}

const STATUSES = ['ACTIVE', 'PENDING_VERIFICATION', 'INACTIVE', 'SUSPENDED', 'BLOCKED', 'DELETED'];

export function AdminUsers() {
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const nav = useNavigate();
  const list = useQuery({
    queryKey: ['admin-users', search, status, page],
    queryFn: () => aapi<{ total: number; rows: UserRow[] }>(`/users${qs({ q: search, status, page, pageSize: 25 })}`),
  });
  return (
    <div>
      <PageHeader title="Users" subtitle="Registered business users. Opening a user's record is recorded in the audit log." />
      <div className="card">
        <form
          className="flex flex-wrap items-end gap-2 border-b border-ink-100 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            setPage(1);
            setSearch(q);
          }}
        >
          <TextInput label="Search" placeholder="Name, email, phone, business, NTN/STRN" value={q} onChange={(e) => setQ(e.target.value)} className="min-w-[240px] flex-1" />
          <SelectInput label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} options={STATUSES.map((s) => ({ value: s, label: human(s) }))} placeholder="All (except deleted)" className="w-48" />
          <Button type="submit" variant="secondary">
            <Search className="h-4 w-4" /> Search
          </Button>
        </form>
        {list.isLoading ? (
          <Spinner />
        ) : list.error ? (
          <div className="p-3"><ErrorBanner error={list.error} /></div>
        ) : list.data!.rows.length === 0 ? (
          <EmptyState title="No users match these filters" />
        ) : (
          <>
            <Table
              head={
                <tr>
                  <th className="table-th">User</th>
                  <th className="table-th">Phone</th>
                  <th className="table-th">Business · NTN/CNIC · STRN</th>
                  <th className="table-th">Status</th>
                  <th className="table-th">Registered</th>
                  <th className="table-th">Last sign-in</th>
                </tr>
              }
            >
              {list.data!.rows.map((u) => (
                <tr key={u.id} className="cursor-pointer hover:bg-ink-50" onClick={() => nav(`/admin/users/${u.id}`)}>
                  <td className="table-td">
                    <Link to={`/admin/users/${u.id}`} className="font-medium text-brand-700 hover:underline" onClick={(e) => e.stopPropagation()}>
                      {u.name}
                    </Link>
                    <p className="text-xs text-ink-500">{u.email}</p>
                  </td>
                  <td className="table-td text-xs">{u.phone ?? '—'}</td>
                  <td className="table-td text-xs">
                    {u.businesses.length === 0
                      ? '—'
                      : u.businesses.map((b) => (
                          <div key={b.id}>
                            {b.name} · <span className="font-mono">{b.ntnCnic}</span>
                            {b.strn ? <> · <span className="font-mono">{b.strn}</span></> : null}
                          </div>
                        ))}
                  </td>
                  <td className="table-td"><Badge tone={USER_STATUS_TONE[u.status] ?? 'gray'}>{human(u.status)}</Badge></td>
                  <td className="table-td whitespace-nowrap text-xs">{dateTime(u.createdAt)}</td>
                  <td className="table-td whitespace-nowrap text-xs">{dateTime(u.lastLoginAt)}</td>
                </tr>
              ))}
            </Table>
            <Pagination page={page} pageSize={25} total={list.data!.total} onPage={setPage} />
          </>
        )}
      </div>
    </div>
  );
}

interface UserDetail {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  status: string;
  statusReason: string | null;
  emailVerifiedAt: string | null;
  createdAt: string;
  lastLoginAt: string | null;
  businesses: {
    id: string;
    role: string;
    name: string;
    ntnCnic: string;
    strn: string | null;
    province: string;
    address: string;
    activities: string[];
    sector: string;
    productionEnabled: boolean;
    credentials: { environment: string; status: string; tokenMasked: string | null; lastCheckedAt: string | null }[];
  }[];
  logins: { id: string; success: boolean; reason: string | null; ip: string | null; userAgent: string | null; createdAt: string }[];
  invoiceStats: { environment: string; status: string; count: number }[];
}

export function AdminUserDetail({ me }: { me: AdminMe }) {
  const { id } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const nav = useNavigate();
  const q = useQuery({ queryKey: ['admin-user', id], queryFn: () => aapi<UserDetail>(`/users/${id}`) });
  const [statusOpen, setStatusOpen] = useState(false);
  const [newStatus, setNewStatus] = useState('SUSPENDED');
  const [reason, setReason] = useState('');
  const [resetOpen, setResetOpen] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState('');
  const [delReason, setDelReason] = useState('');

  const setStatus = useMutation({
    mutationFn: () => aapi(`/users/${id}/status`, { body: { status: newStatus, reason } }),
    onSuccess: () => {
      toast('green', `Status changed to ${human(newStatus)}`);
      setStatusOpen(false);
      setReason('');
      void qc.invalidateQueries({ queryKey: ['admin-user', id] });
      void qc.invalidateQueries({ queryKey: ['admin-users'] });
    },
  });
  const reset = useMutation({
    mutationFn: () => aapi<{ message: string }>(`/users/${id}/password-reset`, { method: 'POST', body: {} }),
    onSuccess: (r) => {
      toast('green', r.message);
      setResetOpen(false);
    },
  });
  const del = useMutation({
    mutationFn: () => aapi(`/users/${id}/delete`, { body: { confirmEmail, reason: delReason } }),
    onSuccess: () => {
      toast('green', 'User deleted (personal data anonymised; financial and audit records retained)');
      void qc.invalidateQueries({ queryKey: ['admin-users'] });
      nav('/admin/users');
    },
  });

  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorBanner error={q.error} />;
  const u = q.data!;
  const canManage = me.permissions.includes('users.manage');
  const canDelete = me.permissions.includes('users.delete');
  const deleted = u.status === 'DELETED';

  return (
    <div className="space-y-5">
      <Link to="/admin/users" className="inline-flex items-center gap-1 text-sm text-ink-600 hover:text-ink-900">
        <ArrowLeft className="h-4 w-4" /> Users
      </Link>
      <PageHeader
        title={u.name}
        subtitle={<>{u.email} · {u.phone ?? 'no phone'} · registered {dateTime(u.createdAt)}</>}
        actions={
          !deleted && (
            <>
              {canManage && (
                <>
                  <Button variant="secondary" onClick={() => setStatusOpen(true)}>
                    <UserCog className="h-4 w-4" /> Change status
                  </Button>
                  <Button variant="secondary" onClick={() => setResetOpen(true)}>
                    <KeyRound className="h-4 w-4" /> Send password reset
                  </Button>
                </>
              )}
              {canDelete && (
                <Button variant="danger" onClick={() => setDelOpen(true)}>
                  <Trash2 className="h-4 w-4" /> Delete
                </Button>
              )}
            </>
          )
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Account">
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-2"><dt className="text-ink-500">Status</dt><dd><Badge tone={USER_STATUS_TONE[u.status] ?? 'gray'}>{human(u.status)}</Badge></dd></div>
            {u.statusReason && <div className="flex justify-between gap-2"><dt className="text-ink-500">Reason</dt><dd className="text-right">{u.statusReason}</dd></div>}
            <div className="flex justify-between gap-2"><dt className="text-ink-500">Email verified</dt><dd>{u.emailVerifiedAt ? dateTime(u.emailVerifiedAt) : 'No'}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-ink-500">Last sign-in</dt><dd>{dateTime(u.lastLoginAt)}</dd></div>
          </dl>
        </Card>
        <Card title="Invoice statistics" className="lg:col-span-2" bodyClass="p-0">
          {u.invoiceStats.length === 0 ? (
            <EmptyState title="No invoices yet" />
          ) : (
            <Table head={<tr><th className="table-th">Environment</th><th className="table-th">Status</th><th className="table-th num">Count</th></tr>}>
              {u.invoiceStats.map((s) => (
                <tr key={s.environment + s.status}>
                  <td className="table-td text-xs">{s.environment}</td>
                  <td className="table-td text-xs">{human(s.status)}</td>
                  <td className="table-td num">{s.count}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
      {u.businesses.map((b) => (
        <Card key={b.id} title={<div><h2 className="text-sm font-semibold">{b.name}</h2><p className="text-xs text-ink-500">Role: {human(b.role)} · {b.productionEnabled ? 'Production enabled' : 'Sandbox only'}</p></div>} actions={<Link className="text-xs font-medium text-brand-700 hover:underline" to={`/admin/invoices?businessId=${b.id}`}>View invoices</Link>}>
          <div className="grid gap-4 md:grid-cols-2">
            <dl className="grid grid-cols-[130px_1fr] gap-x-2 gap-y-1.5 text-sm">
              <dt className="text-ink-500">NTN/CNIC</dt><dd className="font-mono">{b.ntnCnic}</dd>
              <dt className="text-ink-500">STRN</dt><dd className="font-mono">{b.strn ?? '—'}</dd>
              <dt className="text-ink-500">Province</dt><dd>{b.province}</dd>
              <dt className="text-ink-500">Address</dt><dd>{b.address}</dd>
              <dt className="text-ink-500">Business nature</dt><dd>{b.activities.join(', ')}</dd>
              <dt className="text-ink-500">Sector</dt><dd>{b.sector}</dd>
            </dl>
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-500">FBR credentials (masked — tokens are never shown)</p>
              {b.credentials.length === 0 ? (
                <p className="text-sm text-ink-500">No credentials configured.</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {b.credentials.map((c) => (
                    <li key={c.environment} className="flex flex-wrap items-center gap-2">
                      <Badge tone={c.environment === 'PRODUCTION' ? 'green' : 'amber'}>{c.environment}</Badge>
                      <span className="font-mono text-xs">{c.tokenMasked ?? 'no token'}</span>
                      <Badge tone={c.status === 'OK' ? 'green' : c.status === 'UNTESTED' ? 'gray' : 'red'}>{human(c.status)}</Badge>
                      <span className="text-xs text-ink-500">checked {dateTime(c.lastCheckedAt)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </Card>
      ))}
      <Card title="Login history (last 20)" bodyClass="p-0">
        {u.logins.length === 0 ? (
          <EmptyState title="No sign-in attempts recorded" />
        ) : (
          <Table head={<tr><th className="table-th">When</th><th className="table-th">Result</th><th className="table-th">Reason</th><th className="table-th">IP</th><th className="table-th">Device</th></tr>}>
            {u.logins.map((l) => (
              <tr key={l.id}>
                <td className="table-td whitespace-nowrap text-xs">{dateTime(l.createdAt)}</td>
                <td className="table-td"><Badge tone={l.success ? 'green' : 'red'}>{l.success ? 'Success' : 'Failed'}</Badge></td>
                <td className="table-td text-xs">{l.reason ?? '—'}</td>
                <td className="table-td text-xs">{l.ip ?? '—'}</td>
                <td className="table-td max-w-[280px] truncate text-xs text-ink-500" title={l.userAgent ?? ''}>{l.userAgent ?? '—'}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Dialog
        open={statusOpen}
        onClose={() => setStatusOpen(false)}
        title="Change account status"
        footer={
          <>
            <Button variant="secondary" onClick={() => setStatusOpen(false)}>Cancel</Button>
            <Button onClick={() => setStatus.mutate()} loading={setStatus.isPending} disabled={reason.trim().length < 3}>Apply</Button>
          </>
        }
      >
        {setStatus.error && <ErrorBanner error={setStatus.error} />}
        <SelectInput label="New status" required value={newStatus} onChange={(e) => setNewStatus(e.target.value)} options={['ACTIVE', 'INACTIVE', 'SUSPENDED', 'BLOCKED'].map((s) => ({ value: s, label: human(s) }))} />
        <TextArea label="Reason" required rows={3} value={reason} onChange={(e) => setReason(e.target.value)} hint="Recorded in the audit log. Non-active statuses sign the user out of all sessions." />
      </Dialog>

      <ConfirmDialog
        open={resetOpen}
        title="Send password reset"
        message={<>A one-time reset link (valid 1 hour) will be emailed to <strong>{u.email}</strong>. You will not see the link or the new password.</>}
        confirmLabel="Send reset email"
        onConfirm={() => reset.mutate()}
        onClose={() => setResetOpen(false)}
        loading={reset.isPending}
      >
        {reset.error && <ErrorBanner error={reset.error} />}
      </ConfirmDialog>

      <Dialog
        open={delOpen}
        onClose={() => setDelOpen(false)}
        title="Delete user (controlled)"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDelOpen(false)}>Cancel</Button>
            <Button variant="danger" onClick={() => del.mutate()} loading={del.isPending} disabled={confirmEmail.trim().toLowerCase() !== u.email || delReason.trim().length < 5}>
              Delete user
            </Button>
          </>
        }
      >
        <Alert tone="amber" title="This cannot be undone">
          The user's personal data (name, email, phone, password) is anonymised and all sessions are revoked. Businesses, invoices, FBR submission records and audit logs are <strong>retained</strong> for financial-record compliance.
        </Alert>
        {del.error && <ErrorBanner error={del.error} />}
        <TextInput label={`Type the user's email (${u.email}) to confirm`} required value={confirmEmail} onChange={(e) => setConfirmEmail(e.target.value)} autoComplete="off" />
        <TextArea label="Reason" required rows={3} value={delReason} onChange={(e) => setDelReason(e.target.value)} />
      </Dialog>
    </div>
  );
}
