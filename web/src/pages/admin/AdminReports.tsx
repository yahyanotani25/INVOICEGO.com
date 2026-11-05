import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { download } from '@/lib/api';
import { pkr } from '@/lib/format';
import { Alert, Badge, BarChart, Button, Card, EmptyState, ErrorBanner, PageHeader, Spinner, Table, useToast } from '@/components/ui';
import { aapi, human, USER_STATUS_TONE } from '@/components/admin/adminApi';

interface Summary {
  note: string;
  registrationsDaily: { day: string; count: number }[];
  registrationsMonthly: { month: string; count: number }[];
  userStatus: { status: string; count: number }[];
  fbrMonthly: { month: string; status: string; count: number }[];
  userwise: { businessId: string; name: string; ntn: string; invoices: number; accepted: number; failed: number; salesValue: string }[];
}

export default function AdminReports() {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['admin-reports'], queryFn: () => aapi<Summary>('/reports/summary') });
  const fbr = useMemo(() => {
    const m = new Map<string, { accepted: number; failed: number; reconcile: number }>();
    for (const r of q.data?.fbrMonthly ?? []) {
      const e = m.get(r.month) ?? { accepted: 0, failed: 0, reconcile: 0 };
      if (r.status === 'ACCEPTED') e.accepted += r.count;
      else if (r.status === 'RECONCILIATION_REQUIRED') e.reconcile += r.count;
      else e.failed += r.count;
      m.set(r.month, e);
    }
    return [...m.entries()];
  }, [q.data]);

  const exp = async (type: 'users' | 'invoices' | 'userwise', format: 'csv' | 'xlsx') => {
    setBusy(type + format);
    try {
      await download(`/api/admin/reports/export?type=${type}&format=${format}`, `invoicego-${type}.${format}`);
    } catch (e) {
      toast('red', (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const ExportButtons = ({ type }: { type: 'users' | 'invoices' | 'userwise' }) => (
    <>
      <Button size="sm" variant="secondary" onClick={() => exp(type, 'csv')} loading={busy === type + 'csv'}><Download className="h-3.5 w-3.5" /> CSV</Button>
      <Button size="sm" variant="secondary" onClick={() => exp(type, 'xlsx')} loading={busy === type + 'xlsx'}><Download className="h-3.5 w-3.5" /> Excel</Button>
    </>
  );

  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorBanner error={q.error} />;
  const d = q.data!;
  return (
    <div className="space-y-5">
      <PageHeader title="Reports & analytics" subtitle="Registrations, account status, FBR submission outcomes and user-wise invoice activity." />
      <Alert tone="blue">{d.note}</Alert>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Daily registrations (last 90 days)" actions={<ExportButtons type="users" />}>
          <BarChart data={d.registrationsDaily.slice(-31).map((r) => ({ label: r.day.slice(5), value: r.count }))} />
          {d.registrationsDaily.length > 31 && <p className="mt-2 text-xs text-ink-500">Showing the most recent 31 days with registrations.</p>}
        </Card>
        <Card title="Monthly registrations (last 24 months)">
          <BarChart data={d.registrationsMonthly.map((r) => ({ label: r.month, value: r.count }))} />
        </Card>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Users by status">
          {d.userStatus.length === 0 ? <EmptyState title="No users yet" /> : (
            <ul className="space-y-2">
              {d.userStatus.map((s) => (
                <li key={s.status} className="flex items-center justify-between text-sm">
                  <Badge tone={USER_STATUS_TONE[s.status] ?? 'gray'}>{human(s.status)}</Badge>
                  <span className="tabular-nums font-medium">{s.count}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Production FBR outcomes by invoice month" className="lg:col-span-2" actions={<ExportButtons type="invoices" />} bodyClass="p-0">
          {fbr.length === 0 ? <EmptyState title="No production submissions yet" /> : (
            <Table head={<tr><th className="table-th">Month</th><th className="table-th num">Accepted</th><th className="table-th num">Failed</th><th className="table-th num">Reconciliation</th></tr>}>
              {fbr.map(([month, v]) => (
                <tr key={month}>
                  <td className="table-td">{month}</td>
                  <td className="table-td num text-emerald-700">{v.accepted}</td>
                  <td className="table-td num text-red-700">{v.failed}</td>
                  <td className="table-td num text-amber-700">{v.reconcile}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
      <Card title="User-wise invoice report (production)" actions={<ExportButtons type="userwise" />} bodyClass="p-0">
        {d.userwise.length === 0 ? <EmptyState title="No businesses yet" /> : (
          <Table head={<tr><th className="table-th">Business</th><th className="table-th">NTN/CNIC</th><th className="table-th num">Invoices</th><th className="table-th num">Accepted</th><th className="table-th num">Failed</th><th className="table-th num">Accepted sales value (business sales)</th></tr>}>
            {d.userwise.map((u) => (
              <tr key={u.businessId}>
                <td className="table-td">{u.name}</td>
                <td className="table-td font-mono text-xs">{u.ntn}</td>
                <td className="table-td num">{u.invoices}</td>
                <td className="table-td num">{u.accepted}</td>
                <td className="table-td num">{u.failed}</td>
                <td className="table-td num whitespace-nowrap">{pkr(u.salesValue)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
