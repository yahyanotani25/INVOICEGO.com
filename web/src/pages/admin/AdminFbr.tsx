import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Globe } from 'lucide-react';
import { qs } from '@/lib/api';
import { dateTime, OUTCOME_TONE } from '@/lib/format';
import { Alert, Badge, BarChart, Button, Card, EmptyState, ErrorBanner, PageHeader, Pagination, SelectInput, Spinner, Stat, Table, Tabs } from '@/components/ui';
import { aapi, human } from '@/components/admin/adminApi';

interface Overview {
  credentials: { businessId: string; business: string; environment: string; status: string; tokenMasked: string | null; lastCheckedAt: string | null; lastCheckMessage: string | null; productionEnabled: boolean }[];
  last24h: { operation: string; outcome: string; count: number }[];
  httpStatus30d: { httpStatus: number | null; count: number }[];
  fbrErrorCodes30d: { code: string; count: number }[];
  recentFailures: { id: string; businessId: string; invoiceId: string | null; internalNumber?: string; invoiceStatus?: string; operation: string; environment: string; outcome: string; httpStatus: number | null; startedAt: string; errors: { code?: string | null; message?: string }[] | null }[];
  reconciliationQueue: { id: string; business: string; internalNumber: string; environment: string; note: string | null; updatedAt: string }[];
  usage30d: { day: string; operation: string; count: number }[];
  server: { configuredOutboundIps: string[]; hostingCompany: string; hostingCountry: string };
}

interface Attempt {
  id: string;
  businessId: string;
  invoiceId: string | null;
  internalNumber?: string;
  operation: string;
  environment: string;
  url: string;
  httpStatus: number | null;
  outcome: string;
  durationMs: number | null;
  startedAt: string;
  errors: { code?: string | null; message?: string }[] | null;
  errorMessage: string | null;
}

const OPS = ['VALIDATE', 'POST', 'CONNECTION_TEST', 'REG_TYPE_LOOKUP', 'STATL_LOOKUP', 'REFERENCE'];
const OUTCOMES = ['PENDING', 'VALID', 'INVALID', 'AUTH_ERROR', 'HTTP_ERROR', 'NOT_SENT', 'UNCERTAIN', 'BAD_RESPONSE', 'OK'];

function firstError(errs: Attempt['errors']) {
  const e = errs?.[0];
  return e ? `${e.code ? `[${e.code}] ` : ''}${e.message ?? ''}` : '';
}

function OverviewTab() {
  const q = useQuery({ queryKey: ['admin-fbr-overview'], queryFn: () => aapi<Overview>('/fbr/overview'), refetchInterval: 60_000 });
  const detect = useMutation({ mutationFn: () => aapi<{ detectedIp: string | null; note: string }>('/fbr/detect-ip', { method: 'POST', body: {} }) });
  const usage = useMemo(() => {
    const byDay = new Map<string, number>();
    for (const u of q.data?.usage30d ?? []) byDay.set(u.day, (byDay.get(u.day) ?? 0) + u.count);
    return [...byDay.entries()].map(([label, value]) => ({ label: label.slice(5), value }));
  }, [q.data]);
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorBanner error={q.error} />;
  const d = q.data!;
  const sum = (pred: (x: Overview['last24h'][number]) => boolean) => d.last24h.filter(pred).reduce((a, x) => a + x.count, 0);
  const okCreds = d.credentials.filter((c) => c.status === 'OK').length;
  const badCreds = d.credentials.filter((c) => c.status === 'UNAUTHORIZED' || c.status === 'ERROR').length;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Posts (24h)" value={sum((x) => x.operation === 'POST')} />
        <Stat label="Accepted posts (24h)" value={sum((x) => x.operation === 'POST' && x.outcome === 'VALID')} tone="green" />
        <Stat label="Validations (24h)" value={sum((x) => x.operation === 'VALIDATE')} />
        <Stat label="Failures (24h)" value={sum((x) => ['INVALID', 'AUTH_ERROR', 'HTTP_ERROR', 'NOT_SENT', 'BAD_RESPONSE'].includes(x.outcome))} tone="red" />
        <Stat label="Uncertain (24h)" value={sum((x) => x.outcome === 'UNCERTAIN')} tone="amber" />
        <Stat label="Credentials OK / failing" value={`${okCreds} / ${badCreds}`} sub={`${d.credentials.length} configured`} />
      </div>

      <Card title="Server IP information (for IRIS whitelisting)" actions={<Button size="sm" variant="secondary" onClick={() => detect.mutate()} loading={detect.isPending}><Globe className="h-3.5 w-3.5" /> Detect current egress IP</Button>}>
        <dl className="grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-[200px_1fr]">
          <dt className="text-ink-500">Configured static outbound IP(s)</dt>
          <dd className="font-mono">{d.server.configuredOutboundIps.length ? d.server.configuredOutboundIps.join(', ') : <span className="font-sans text-amber-700">Not configured (OUTBOUND_IPS)</span>}</dd>
          <dt className="text-ink-500">Hosting company</dt><dd>{d.server.hostingCompany || '—'}</dd>
          <dt className="text-ink-500">Hosting country</dt><dd>{d.server.hostingCountry || '—'}</dd>
          {detect.data && (<><dt className="text-ink-500">Detected egress IP now</dt><dd className="font-mono">{detect.data.detectedIp ?? 'Could not detect'}</dd></>)}
        </dl>
        {detect.error && <div className="mt-2"><ErrorBanner error={detect.error} /></div>}
        {detect.data && d.server.configuredOutboundIps.length > 0 && detect.data.detectedIp && !d.server.configuredOutboundIps.includes(detect.data.detectedIp) && (
          <Alert tone="amber" className="mt-3">The detected egress IP is not in the configured list. Businesses whitelisting the configured IP in IRIS may receive HTTP 401 from FBR.</Alert>
        )}
        <p className="mt-3 text-xs text-ink-500">Businesses enter these IPs in IRIS (Digital Invoicing → API Integration → IP Whitelisting: 1–3 IPs, or an .xls upload up to 1 MB). PRAL accepts or rejects within about 2 working hours (DI User Manual v1.5). Only whitelist static IPs that this deployment controls.</p>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="API usage — last 30 days (all operations)"><BarChart data={usage} /></Card>
        <div className="grid gap-4">
          <Card title="HTTP status codes (30 days)">
            {d.httpStatus30d.length === 0 ? <EmptyState title="No FBR calls yet" /> : (
              <div className="flex flex-wrap gap-2">
                {d.httpStatus30d.map((h) => (
                  <Badge key={String(h.httpStatus)} tone={h.httpStatus === 200 ? 'green' : h.httpStatus === null ? 'amber' : h.httpStatus === 401 ? 'red' : 'gray'}>
                    {h.httpStatus ?? 'no response'}: {h.count}
                  </Badge>
                ))}
              </div>
            )}
          </Card>
          <Card title="FBR error codes (30 days)">
            {d.fbrErrorCodes30d.length === 0 ? <EmptyState title="No FBR error codes recorded" /> : (
              <div className="flex flex-wrap gap-2">
                {d.fbrErrorCodes30d.map((c) => <Badge key={c.code} tone="red"><span className="font-mono">{c.code}</span> × {c.count}</Badge>)}
              </div>
            )}
          </Card>
        </div>
      </div>

      <Card title={`Reconciliation queue (${d.reconciliationQueue.length})`} bodyClass="p-0">
        {d.reconciliationQueue.length === 0 ? <EmptyState title="No invoices awaiting reconciliation" /> : (
          <Table head={<tr><th className="table-th">Invoice</th><th className="table-th">Business</th><th className="table-th">Env.</th><th className="table-th">Note</th><th className="table-th">Updated</th></tr>}>
            {d.reconciliationQueue.map((r) => (
              <tr key={r.id}>
                <td className="table-td"><Link className="text-brand-700 hover:underline" to={`/admin/invoices/${r.id}`}>{r.internalNumber}</Link></td>
                <td className="table-td text-xs">{r.business}</td>
                <td className="table-td"><Badge tone={r.environment === 'PRODUCTION' ? 'green' : 'amber'}>{r.environment}</Badge></td>
                <td className="table-td max-w-md text-xs">{r.note ?? '—'}</td>
                <td className="table-td whitespace-nowrap text-xs">{dateTime(r.updatedAt)}</td>
              </tr>
            ))}
          </Table>
        )}
        <p className="border-t border-ink-100 px-4 py-2 text-xs text-ink-500">Uncertain outcomes are resolved by the business after checking the IRIS Invoice Dashboard. InvoiceGO never resubmits them automatically.</p>
      </Card>

      <Card title="Recent failed submissions" bodyClass="p-0">
        {d.recentFailures.length === 0 ? <EmptyState title="No failures recorded" /> : (
          <Table head={<tr><th className="table-th">When</th><th className="table-th">Invoice</th><th className="table-th">Operation</th><th className="table-th">Env.</th><th className="table-th">Outcome</th><th className="table-th">HTTP</th><th className="table-th">First error</th></tr>}>
            {d.recentFailures.map((f) => (
              <tr key={f.id}>
                <td className="table-td whitespace-nowrap text-xs">{dateTime(f.startedAt)}</td>
                <td className="table-td text-xs">{f.invoiceId ? <Link className="text-brand-700 hover:underline" to={`/admin/invoices/${f.invoiceId}`}>{f.internalNumber ?? 'invoice'}</Link> : '—'}{f.invoiceStatus && <p className="text-ink-500">{human(f.invoiceStatus)}</p>}</td>
                <td className="table-td text-xs">{f.operation}</td>
                <td className="table-td text-xs">{f.environment}</td>
                <td className="table-td"><Badge tone={OUTCOME_TONE[f.outcome] ?? 'gray'}>{human(f.outcome)}</Badge></td>
                <td className="table-td text-xs">{f.httpStatus ?? '—'}</td>
                <td className="table-td max-w-md text-xs">{firstError(f.errors) || '—'}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card title="API connection status by business" bodyClass="p-0">
        {d.credentials.length === 0 ? <EmptyState title="No business has configured FBR credentials yet" /> : (
          <Table head={<tr><th className="table-th">Business</th><th className="table-th">Environment</th><th className="table-th">Token (masked)</th><th className="table-th">Status</th><th className="table-th">Last checked</th><th className="table-th">Message</th></tr>}>
            {d.credentials.map((c) => (
              <tr key={c.businessId + c.environment}>
                <td className="table-td text-xs">{c.business}{c.environment === 'PRODUCTION' && <p className="text-ink-500">{c.productionEnabled ? 'Production submission enabled' : 'Production not enabled'}</p>}</td>
                <td className="table-td"><Badge tone={c.environment === 'PRODUCTION' ? 'green' : 'amber'}>{c.environment}</Badge></td>
                <td className="table-td font-mono text-xs">{c.tokenMasked ?? 'none'}</td>
                <td className="table-td"><Badge tone={c.status === 'OK' ? 'green' : c.status === 'UNTESTED' ? 'gray' : 'red'}>{human(c.status)}</Badge></td>
                <td className="table-td whitespace-nowrap text-xs">{dateTime(c.lastCheckedAt)}</td>
                <td className="table-td max-w-sm text-xs text-ink-600">{c.lastCheckMessage ?? '—'}</td>
              </tr>
            ))}
          </Table>
        )}
        <p className="border-t border-ink-100 px-4 py-2 text-xs text-ink-500">Tenant tokens are encrypted at rest and are never displayed in full — only the last four characters.</p>
      </Card>
    </div>
  );
}

function AttemptsTab() {
  const [operation, setOperation] = useState('');
  const [outcome, setOutcome] = useState('');
  const [environment, setEnvironment] = useState('');
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: ['admin-fbr-attempts', operation, outcome, environment, page], queryFn: () => aapi<{ total: number; rows: Attempt[] }>(`/fbr/attempts${qs({ operation, outcome, environment, page })}`) });
  return (
    <div className="card">
      <div className="flex flex-wrap items-end gap-2 border-b border-ink-100 p-3">
        <SelectInput label="Operation" value={operation} onChange={(e) => { setOperation(e.target.value); setPage(1); }} placeholder="All" options={OPS.map((o) => ({ value: o, label: human(o) }))} className="w-48" />
        <SelectInput label="Outcome" value={outcome} onChange={(e) => { setOutcome(e.target.value); setPage(1); }} placeholder="All" options={OUTCOMES.map((o) => ({ value: o, label: human(o) }))} className="w-44" />
        <SelectInput label="Environment" value={environment} onChange={(e) => { setEnvironment(e.target.value); setPage(1); }} placeholder="Both" options={[{ value: 'PRODUCTION', label: 'Production' }, { value: 'SANDBOX', label: 'Sandbox' }]} className="w-40" />
      </div>
      {q.isLoading ? <Spinner /> : q.error ? <div className="p-3"><ErrorBanner error={q.error} /></div> : q.data!.rows.length === 0 ? <EmptyState title="No API log entries match" /> : (
        <>
          <Table head={<tr><th className="table-th">When</th><th className="table-th">Operation</th><th className="table-th">Env.</th><th className="table-th">Invoice</th><th className="table-th">Outcome</th><th className="table-th">HTTP</th><th className="table-th num">ms</th><th className="table-th">Endpoint</th><th className="table-th">Error</th></tr>}>
            {q.data!.rows.map((a) => (
              <tr key={a.id}>
                <td className="table-td whitespace-nowrap text-xs">{dateTime(a.startedAt)}</td>
                <td className="table-td text-xs">{human(a.operation)}</td>
                <td className="table-td text-xs">{a.environment}</td>
                <td className="table-td text-xs">{a.invoiceId ? <Link className="text-brand-700 hover:underline" to={`/admin/invoices/${a.invoiceId}`}>{a.internalNumber ?? 'invoice'}</Link> : '—'}</td>
                <td className="table-td"><Badge tone={OUTCOME_TONE[a.outcome] ?? 'gray'}>{human(a.outcome)}</Badge></td>
                <td className="table-td text-xs">{a.httpStatus ?? '—'}</td>
                <td className="table-td num text-xs">{a.durationMs ?? '—'}</td>
                <td className="table-td max-w-[220px] truncate font-mono text-[11px] text-ink-500" title={a.url}>{a.url.replace(/^https?:\/\/[^/]+/, '')}</td>
                <td className="table-td max-w-xs text-xs">{firstError(a.errors) || a.errorMessage || '—'}</td>
              </tr>
            ))}
          </Table>
          <Pagination page={page} pageSize={50} total={q.data!.total} onPage={setPage} />
        </>
      )}
      <p className="border-t border-ink-100 px-4 py-2 text-xs text-ink-500">Sanitised log: FBR tokens are never stored with requests. Open an invoice to see full request/response bodies.</p>
    </div>
  );
}

export default function AdminFbr() {
  const [tab, setTab] = useState('overview');
  return (
    <div className="space-y-4">
      <PageHeader title="FBR / PRAL monitoring" subtitle="Connection status, submission health, response codes and API logs across all businesses." />
      <Tabs tabs={[{ id: 'overview', label: 'Overview' }, { id: 'logs', label: 'API logs' }]} active={tab} onChange={setTab} />
      {tab === 'overview' ? <OverviewTab /> : <AttemptsTab />}
    </div>
  );
}
