import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { FilePlus2, FileSpreadsheet, FlaskConical } from 'lucide-react';
import { api } from '@/lib/api';
import { dateOnly, dateTime, pkr, STATUS_LABEL, STATUS_TONE } from '@/lib/format';
import { Alert, Badge, Button, Card, EnvBadge, ErrorBanner, PageHeader, Spinner, Stat, Table } from '@/components/ui';
import { OutcomeBadge } from '@/components/FbrResult';

interface Dash {
  today: { date: string; time: string; monthStart: string; monthEnd: string };
  counts: { totalProduction: number; sandboxTotal: number; currentMonth: number; drafts: number; pending: number; accepted: number; failed: number; reconciliation: number };
  production: { allTime: Record<string, string>; currentMonth: Record<string, string> };
  recentInvoices: { id: string; internalNumber: string; environment: string; buyerBusinessName: string; invoiceDate: string; status: string; grandTotal: string; fbrInvoiceNumber: string | null }[];
  recentAttempts: { id: string; operation: string; environment: string; outcome: string; httpStatus: number | null; startedAt: string; internalNumber?: string; invoiceId: string | null; fbrInvoiceNo: string | null }[];
  integration: { productionEnabled: boolean; sandbox: { status: string; lastCheckedAt: string | null; tokenSaved: boolean } | null; production: { status: string; lastCheckedAt: string | null; tokenSaved: boolean } | null };
  scenarios: { required: number; passed: number; remaining: string[] };
}

export default function Dashboard() {
  const q = useQuery({ queryKey: ['dashboard'], queryFn: () => api<Dash>('/api/app/dashboard'), refetchInterval: 60_000 });
  if (q.isLoading) return <Spinner />;
  if (!q.data) return <ErrorBanner error={q.error} />;
  const d = q.data;
  const credTone = (c: { status: string } | null) => (!c ? 'gray' : c.status === 'OK' ? 'green' : c.status === 'UNTESTED' ? 'amber' : 'red');
  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        subtitle={`Today ${dateOnly(d.today.date)} · ${d.today.time} PKT · invoices can be dated ${dateOnly(d.today.monthStart)} – ${dateOnly(d.today.monthEnd)}`}
        actions={
          <>
            <Link to="/app/bulk"><Button variant="secondary"><FileSpreadsheet className="h-4 w-4" /> Bulk upload</Button></Link>
            <Link to="/app/invoices/new"><Button><FilePlus2 className="h-4 w-4" /> Create invoice</Button></Link>
          </>
        }
      />
      {d.counts.reconciliation > 0 && (
        <Alert tone="amber" title={`${d.counts.reconciliation} submission(s) need reconciliation`}>
          Their FBR outcome is uncertain. <Link to="/app/invoices?status=RECONCILIATION_REQUIRED" className="underline">Review them</Link> before any reattempt.
        </Alert>
      )}
      <section aria-label="Production invoice counts" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Total invoices (production)" value={d.counts.totalProduction} sub={`${d.counts.sandboxTotal} sandbox test invoices kept separately`} />
        <Stat label="This month" value={d.counts.currentMonth} />
        <Stat label="Accepted by FBR" value={d.counts.accepted} tone="green" />
        <Stat label="Failed submissions" value={d.counts.failed} tone={d.counts.failed ? 'red' : undefined} />
        <Stat label="Drafts" value={d.counts.drafts} />
        <Stat label="Pending submission" value={d.counts.pending} />
        <Stat label="Need reconciliation" value={d.counts.reconciliation} tone={d.counts.reconciliation ? 'amber' : undefined} />
        <Stat label="Scenarios passed" value={`${d.scenarios.passed}/${d.scenarios.required}`} sub={d.scenarios.remaining.length ? `Remaining: ${d.scenarios.remaining.slice(0, 6).join(', ')}${d.scenarios.remaining.length > 6 ? '…' : ''}` : 'All required scenarios passed'} />
      </section>
      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="Production sales (accepted invoices)" className="lg:col-span-2">
          <div className="grid gap-4 sm:grid-cols-2">
            {(['currentMonth', 'allTime'] as const).map((k) => (
              <dl key={k} className="space-y-1.5 text-sm">
                <p className="text-xs font-semibold uppercase text-ink-500">{k === 'currentMonth' ? 'This month' : 'All time'}</p>
                {[['Sales value (excl. ST)', 'valueExclST'], ['Sales tax', 'salesTax'], ['Further tax', 'furtherTax'], ['ST withheld', 'withheld'], ['Gross invoice value', 'grandTotal']].map(([l, f]) => (
                  <div key={f} className="flex justify-between"><dt className="text-ink-600">{l}</dt><dd className="tabular-nums font-medium">{pkr(d.production[k][f])}</dd></div>
                ))}
              </dl>
            ))}
          </div>
          <p className="mt-3 text-xs text-ink-500">Sandbox test values are excluded. <Link to="/app/reports" className="text-brand-700 underline">Daily, monthly, quarterly and yearly reports</Link></p>
        </Card>
        <Card title="FBR integration">
          <ul className="space-y-2 text-sm">
            <li className="flex items-center justify-between"><span>Sandbox token</span><Badge tone={credTone(d.integration.sandbox)}>{d.integration.sandbox?.tokenSaved ? d.integration.sandbox.status : 'Not set'}</Badge></li>
            <li className="flex items-center justify-between"><span>Production token</span><Badge tone={credTone(d.integration.production)}>{d.integration.production?.tokenSaved ? d.integration.production.status : 'Not set'}</Badge></li>
            <li className="flex items-center justify-between"><span>Production submission</span>{d.integration.productionEnabled ? <Badge tone="green">Enabled</Badge> : <Badge tone="amber">Disabled</Badge>}</li>
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link to="/app/fbr"><Button size="sm" variant="secondary">Manage</Button></Link>
            <Link to="/app/sandbox"><Button size="sm" variant="secondary"><FlaskConical className="h-3.5 w-3.5" /> Scenarios</Button></Link>
          </div>
        </Card>
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Recent invoices" bodyClass="p-0" actions={<Link to="/app/invoices" className="text-xs text-brand-700 hover:underline">View all</Link>}>
          <Table head={<tr><th className="table-th">Invoice</th><th className="table-th">Buyer</th><th className="table-th">Status</th><th className="table-th num">Total</th></tr>}>
            {d.recentInvoices.length === 0 && <tr><td colSpan={4} className="table-td text-center text-ink-500">No invoices yet.</td></tr>}
            {d.recentInvoices.map((r) => (
              <tr key={r.id}>
                <td className="table-td"><Link to={`/app/invoices/${r.id}`} className="font-medium text-brand-700 hover:underline">{r.internalNumber}</Link><div className="flex gap-1 pt-0.5"><EnvBadge env={r.environment} /></div></td>
                <td className="table-td">{r.buyerBusinessName}<div className="text-xs text-ink-500">{dateOnly(r.invoiceDate)}</div></td>
                <td className="table-td"><Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge></td>
                <td className="table-td num">{pkr(r.grandTotal)}</td>
              </tr>
            ))}
          </Table>
        </Card>
        <Card title="Recent FBR activity" bodyClass="p-0">
          <Table head={<tr><th className="table-th">When</th><th className="table-th">Call</th><th className="table-th">Outcome</th></tr>}>
            {d.recentAttempts.length === 0 && <tr><td colSpan={3} className="table-td text-center text-ink-500">No FBR calls yet.</td></tr>}
            {d.recentAttempts.map((a) => (
              <tr key={a.id}>
                <td className="table-td text-xs">{dateTime(a.startedAt)}</td>
                <td className="table-td text-xs">{a.operation} · {a.environment.toLowerCase()} {a.invoiceId && <Link className="text-brand-700 hover:underline" to={`/app/invoices/${a.invoiceId}`}>{a.internalNumber}</Link>}</td>
                <td className="table-td"><OutcomeBadge outcome={a.outcome} /> {a.httpStatus && <span className="text-xs text-ink-500">HTTP {a.httpStatus}</span>}</td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>
    </div>
  );
}
