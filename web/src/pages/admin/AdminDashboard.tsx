import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Card, EmptyState, ErrorBanner, PageHeader, Spinner, Stat, Table } from '@/components/ui';
import { dateTime } from '@/lib/format';
import { aapi, human, type AuditRow } from '@/components/admin/adminApi';

interface Dash {
  users: { total: number; active: number; suspended: number; blocked: number; inactive: number; pendingVerification: number };
  invoices: { production: number; sandbox: number; accepted: number; failed: number; pending: number; reconciliation: number };
  recentActivity: AuditRow[];
}

export default function AdminDashboard() {
  const q = useQuery({ queryKey: ['admin-dashboard'], queryFn: () => aapi<Dash>('/dashboard'), refetchInterval: 60_000 });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorBanner error={q.error} />;
  const d = q.data!;
  return (
    <div className="space-y-6">
      <PageHeader title="Platform overview" subtitle="Users, FBR submission health and recent administrator/system activity. Subscription and payment statistics are not part of this release." />
      <section aria-labelledby="users-h">
        <h2 id="users-h" className="mb-2 text-sm font-semibold text-ink-700">
          Registered users
        </h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Stat label="Total users" value={d.users.total} />
          <Stat label="Active" value={d.users.active} tone="green" />
          <Stat label="Pending verification" value={d.users.pendingVerification} />
          <Stat label="Inactive" value={d.users.inactive} />
          <Stat label="Suspended" value={d.users.suspended} tone="amber" />
          <Stat label="Blocked" value={d.users.blocked} tone="red" />
        </div>
      </section>
      <section aria-labelledby="inv-h">
        <h2 id="inv-h" className="mb-2 text-sm font-semibold text-ink-700">
          Invoices &amp; FBR submissions
        </h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Stat label="Production invoices" value={d.invoices.production} />
          <Stat label="Accepted by FBR" value={d.invoices.accepted} tone="green" sub="Production" />
          <Stat label="Failed" value={d.invoices.failed} tone="red" sub="Rejected / validation failed" />
          <Stat label="Pending" value={d.invoices.pending} sub="Draft, validated or in progress" />
          <Stat label="Reconciliation required" value={d.invoices.reconciliation} tone="amber" sub="All environments" />
          <Stat label="Sandbox invoices" value={d.invoices.sandbox} sub="Test only — kept separate" />
        </div>
      </section>
      <Card title="Recent activity" actions={<Link className="text-xs font-medium text-brand-700 hover:underline" to="/admin/security">Full audit log</Link>} bodyClass="p-0">
        {d.recentActivity.length === 0 ? (
          <EmptyState title="No activity recorded yet" />
        ) : (
          <Table
            head={
              <tr>
                <th className="table-th">When</th>
                <th className="table-th">Actor</th>
                <th className="table-th">Action</th>
                <th className="table-th">Entity</th>
                <th className="table-th">IP</th>
              </tr>
            }
          >
            {d.recentActivity.map((a) => (
              <tr key={a.id}>
                <td className="table-td whitespace-nowrap text-xs">{dateTime(a.createdAt)}</td>
                <td className="table-td text-xs">{human(a.actorKind)}</td>
                <td className="table-td font-mono text-xs">{a.action}</td>
                <td className="table-td text-xs text-ink-500">{a.entityType ? `${a.entityType} ${a.entityId?.slice(0, 10) ?? ''}` : '—'}</td>
                <td className="table-td text-xs text-ink-500">{a.ip ?? '—'}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
