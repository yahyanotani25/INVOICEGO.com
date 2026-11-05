import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, RotateCcw, Search } from 'lucide-react';
import type { AdminMe } from '@/lib/auth';
import { qs } from '@/lib/api';
import { dateOnly, dateTime, OUTCOME_TONE, pkr, qty, regLabel, STATUS_LABEL, STATUS_TONE, typeLabel } from '@/lib/format';
import { Alert, Badge, Button, Card, Dialog, EmptyState, EnvBadge, ErrorBanner, PageHeader, Pagination, SelectInput, Spinner, Table, TextArea, TextInput, useToast } from '@/components/ui';
import { aapi, human, prettyJson, type ExplainedIssue } from '@/components/admin/adminApi';

interface Row {
  id: string;
  internalNumber: string;
  business: { name: string; ntnCnic: string };
  businessId: string;
  customer: string;
  amount: string;
  invoiceDate: string;
  environment: string;
  status: string;
  fbrInvoiceNumber: string | null;
  createdAt: string;
}

export function AdminInvoices() {
  const [params, setParams] = useSearchParams();
  const businessId = params.get('businessId') ?? '';
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState(params.get('status') ?? '');
  const [environment, setEnvironment] = useState('');
  const [page, setPage] = useState(1);
  const nav = useNavigate();
  const list = useQuery({
    queryKey: ['admin-invoices', search, status, environment, businessId, page],
    queryFn: () => aapi<{ total: number; rows: Row[] }>(`/invoices${qs({ q: search, status, environment, businessId, page })}`),
  });
  return (
    <div>
      <PageHeader title="Invoice oversight" subtitle="All businesses' invoices. Viewing invoices and details is recorded in the audit log." />
      {businessId && (
        <Alert tone="blue" className="mb-3">
          Filtered to one business.{' '}
          <button className="underline" onClick={() => { params.delete('businessId'); setParams(params); setPage(1); }}>
            Show all businesses
          </button>
        </Alert>
      )}
      <div className="card">
        <form className="flex flex-wrap items-end gap-2 border-b border-ink-100 p-3" onSubmit={(e) => { e.preventDefault(); setPage(1); setSearch(q); }}>
          <TextInput label="Search" placeholder="Invoice no., FBR no., customer, business" value={q} onChange={(e) => setQ(e.target.value)} className="min-w-[220px] flex-1" />
          <SelectInput label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} placeholder="All statuses" options={Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label }))} className="w-52" />
          <SelectInput label="Environment" value={environment} onChange={(e) => { setEnvironment(e.target.value); setPage(1); }} placeholder="Both" options={[{ value: 'PRODUCTION', label: 'Production' }, { value: 'SANDBOX', label: 'Sandbox' }]} className="w-40" />
          <Button type="submit" variant="secondary"><Search className="h-4 w-4" /> Search</Button>
        </form>
        {list.isLoading ? (
          <Spinner />
        ) : list.error ? (
          <div className="p-3"><ErrorBanner error={list.error} /></div>
        ) : list.data!.rows.length === 0 ? (
          <EmptyState title="No invoices match these filters" />
        ) : (
          <>
            <Table
              head={
                <tr>
                  <th className="table-th">Invoice</th>
                  <th className="table-th">Business</th>
                  <th className="table-th">Customer</th>
                  <th className="table-th">Date</th>
                  <th className="table-th">Env.</th>
                  <th className="table-th">Status</th>
                  <th className="table-th num">Amount</th>
                  <th className="table-th">FBR invoice no.</th>
                </tr>
              }
            >
              {list.data!.rows.map((r) => (
                <tr key={r.id} className="cursor-pointer hover:bg-ink-50" onClick={() => nav(`/admin/invoices/${r.id}`)}>
                  <td className="table-td"><Link to={`/admin/invoices/${r.id}`} onClick={(e) => e.stopPropagation()} className="font-medium text-brand-700 hover:underline">{r.internalNumber}</Link></td>
                  <td className="table-td text-xs">{r.business.name}<p className="font-mono text-ink-500">{r.business.ntnCnic}</p></td>
                  <td className="table-td text-xs">{r.customer}</td>
                  <td className="table-td whitespace-nowrap text-xs">{dateOnly(r.invoiceDate)}</td>
                  <td className="table-td"><EnvBadge env={r.environment} /></td>
                  <td className="table-td"><Badge tone={STATUS_TONE[r.status] ?? 'gray'}>{STATUS_LABEL[r.status] ?? r.status}</Badge></td>
                  <td className="table-td num whitespace-nowrap">{pkr(r.amount)}</td>
                  <td className="table-td font-mono text-xs">{r.fbrInvoiceNumber ?? '—'}</td>
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

interface InvoiceDetail {
  business: { name: string; ntnCnic: string };
  invoice: {
    id: string;
    environment: string;
    internalNumber: string;
    invoiceType: string;
    invoiceDate: string;
    invoiceTime: string;
    paymentMode: string | null;
    invoiceRefNo: string;
    scenarioId: string | null;
    seller: { ntnCnic: string; businessName: string; province: string; address: string };
    buyerNtnCnic: string;
    buyerBusinessName: string;
    buyerProvince: string;
    buyerAddress: string;
    buyerRegistrationType: string | null;
    buyerCheck: { result: string; checkedAt: string | null };
    status: string;
    source: string;
    totals: Record<string, string | null>;
    fbrInvoiceNumber: string | null;
    fbrDated: string | null;
    acceptedAt: string | null;
    acceptedViaReconcile: boolean;
    reconciliationNote: string | null;
    createdAt: string;
    updatedAt: string;
    items: {
      id: string;
      lineNo: number;
      saleType: string;
      hsCode: string;
      productDescription: string;
      rate: string;
      uom: string;
      quantity: string | null;
      unitPrice: string | null;
      discount: string | null;
      valueSalesExcludingST: string | null;
      salesTaxApplicable: string | null;
      furtherTax: string | null;
      extraTax: string | null;
      fedPayable: string | null;
      salesTaxWithheldAtSource: string | null;
      totalValues: string | null;
      sroScheduleNo: string;
      sroItemSerialNo: string;
      fbr: { itemInvoiceNo: string | null; statusCode: string | null; errorCode: string | null; error: string | null };
    }[];
  };
  attempts: {
    id: string;
    operation: string;
    url: string;
    httpStatus: number | null;
    outcome: string;
    fbrInvoiceNo: string | null;
    startedAt: string;
    durationMs: number | null;
    initiatedKind: string | null;
    requestBody: string | null;
    responseBody: string | null;
    issues: ExplainedIssue[];
  }[];
}

export function IssueList({ issues }: { issues: ExplainedIssue[] }) {
  if (!issues.length) return null;
  return (
    <ul className="mt-2 space-y-1.5">
      {issues.map((i, k) => (
        <li key={k} className="rounded-lg border border-red-100 bg-red-50/60 px-3 py-2 text-xs text-ink-800">
          <p className="font-medium">
            {i.itemSNo ? `Item ${i.itemSNo} · ` : ''}
            {i.code ? <span className="font-mono">[{i.code}] </span> : null}
            {i.message || i.fbrMessage}
          </p>
          {i.fbrDescription && <p className="text-ink-600">{i.fbrDescription}</p>}
          {i.fieldLabel && <p className="text-ink-600">Field: {i.fieldLabel}</p>}
          {i.action && <p className="text-ink-600">Action: {i.action}</p>}
          {!i.known && i.scope !== 'HTTP' && i.scope !== 'NETWORK' && <p className="text-amber-700">Not in the supplied FBR error catalogue — original message preserved.</p>}
        </li>
      ))}
    </ul>
  );
}

export function AdminInvoiceDetail({ me }: { me: AdminMe }) {
  const { id } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['admin-invoice', id], queryFn: () => aapi<InvoiceDetail>(`/invoices/${id}`) });
  const [retryOpen, setRetryOpen] = useState(false);
  const [reason, setReason] = useState('');
  const retry = useMutation({
    mutationFn: () => aapi<{ outcome: string; status: string; issues: ExplainedIssue[] }>(`/invoices/${id}/retry`, { body: { reason } }),
    onSuccess: (r) => {
      toast(r.status === 'ACCEPTED' ? 'green' : 'amber', `Retry finished: ${human(r.outcome)} → ${STATUS_LABEL[r.status] ?? r.status}`);
      setRetryOpen(false);
      setReason('');
      void qc.invalidateQueries({ queryKey: ['admin-invoice', id] });
    },
  });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorBanner error={q.error} />;
  const { invoice: inv, business, attempts } = q.data!;
  const t = inv.totals;
  const canRetry = me.permissions.includes('fbr.retry') && inv.status === 'VALIDATED';

  return (
    <div className="space-y-5">
      <Link to="/admin/invoices" className="inline-flex items-center gap-1 text-sm text-ink-600 hover:text-ink-900"><ArrowLeft className="h-4 w-4" /> Invoices</Link>
      <PageHeader
        title={`${typeLabel(inv.invoiceType)} ${inv.internalNumber}`}
        subtitle={<>{business.name} ({business.ntnCnic}) · created {dateTime(inv.createdAt)}</>}
        actions={
          <>
            <EnvBadge env={inv.environment} />
            <Badge tone={STATUS_TONE[inv.status] ?? 'gray'}>{STATUS_LABEL[inv.status] ?? inv.status}</Badge>
            {canRetry && <Button variant="secondary" onClick={() => setRetryOpen(true)}><RotateCcw className="h-4 w-4" /> Controlled retry</Button>}
          </>
        }
      />
      {inv.status === 'RECONCILIATION_REQUIRED' && (
        <Alert tone="amber" title="Outcome uncertain — reconciliation required">
          The last submission may or may not have been recorded by FBR. It must be reconciled by the business against the IRIS Invoice Dashboard before any reattempt; administrators cannot blindly retry it. {inv.reconciliationNote && <>Note: {inv.reconciliationNote}</>}
        </Alert>
      )}
      {inv.status === 'VALIDATED' && attempts.some((a) => a.operation === 'POST') && (
        <Alert tone="blue">The previous submission attempt was not delivered or was refused before recording (e.g. network not reachable, HTTP 401/4xx). A controlled retry re-applies the current-month rule and buyer checks.</Alert>
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Invoice">
          <dl className="grid grid-cols-[120px_1fr] gap-x-2 gap-y-1.5 text-sm">
            <dt className="text-ink-500">Date / time</dt><dd>{dateOnly(inv.invoiceDate)} {inv.invoiceTime}</dd>
            <dt className="text-ink-500">Payment mode</dt><dd>{inv.paymentMode ?? '—'}</dd>
            <dt className="text-ink-500">Reference no.</dt><dd className="font-mono text-xs">{inv.invoiceRefNo || '—'}</dd>
            {inv.scenarioId && <><dt className="text-ink-500">Scenario</dt><dd>{inv.scenarioId}</dd></>}
            <dt className="text-ink-500">Source</dt><dd>{human(inv.source)}</dd>
            <dt className="text-ink-500">FBR invoice no.</dt><dd className="font-mono text-xs">{inv.fbrInvoiceNumber ?? '—'}</dd>
            <dt className="text-ink-500">FBR dated</dt><dd>{inv.fbrDated ?? '—'}</dd>
            {inv.acceptedViaReconcile && <><dt className="text-ink-500">Accepted via</dt><dd>Reconciliation</dd></>}
          </dl>
        </Card>
        <Card title="Seller">
          <dl className="grid grid-cols-[90px_1fr] gap-x-2 gap-y-1.5 text-sm">
            <dt className="text-ink-500">Name</dt><dd>{inv.seller.businessName}</dd>
            <dt className="text-ink-500">NTN/CNIC</dt><dd className="font-mono">{inv.seller.ntnCnic}</dd>
            <dt className="text-ink-500">Province</dt><dd>{inv.seller.province}</dd>
            <dt className="text-ink-500">Address</dt><dd>{inv.seller.address}</dd>
          </dl>
        </Card>
        <Card title="Buyer">
          <dl className="grid grid-cols-[90px_1fr] gap-x-2 gap-y-1.5 text-sm">
            <dt className="text-ink-500">Name</dt><dd>{inv.buyerBusinessName}</dd>
            <dt className="text-ink-500">NTN/CNIC</dt><dd className="font-mono">{inv.buyerNtnCnic || '—'}</dd>
            <dt className="text-ink-500">Province</dt><dd>{inv.buyerProvince}</dd>
            <dt className="text-ink-500">Address</dt><dd>{inv.buyerAddress}</dd>
            <dt className="text-ink-500">Type</dt><dd>{regLabel(inv.buyerRegistrationType)}</dd>
            <dt className="text-ink-500">FBR check</dt><dd>{human(inv.buyerCheck.result)}{inv.buyerCheck.checkedAt ? ` · ${dateTime(inv.buyerCheck.checkedAt)}` : ''}</dd>
          </dl>
        </Card>
      </div>
      <Card title="Items" bodyClass="p-0">
        <Table
          head={
            <tr>
              <th className="table-th">#</th>
              <th className="table-th">HS code / description</th>
              <th className="table-th">Sale type · rate</th>
              <th className="table-th num">Qty</th>
              <th className="table-th num">Value excl. ST</th>
              <th className="table-th num">Sales tax</th>
              <th className="table-th num">Total</th>
              <th className="table-th">FBR item result</th>
            </tr>
          }
        >
          {inv.items.map((it) => (
            <tr key={it.id}>
              <td className="table-td">{it.lineNo}</td>
              <td className="table-td text-xs"><span className="font-mono">{it.hsCode}</span><p>{it.productDescription}</p></td>
              <td className="table-td text-xs">{it.saleType}<p className="text-ink-500">{it.rate}{it.sroScheduleNo ? ` · ${it.sroScheduleNo}` : ''}{it.sroItemSerialNo ? ` #${it.sroItemSerialNo}` : ''}</p></td>
              <td className="table-td num text-xs">{qty(it.quantity)} {it.uom}</td>
              <td className="table-td num">{pkr(it.valueSalesExcludingST, { symbol: false })}</td>
              <td className="table-td num">{pkr(it.salesTaxApplicable, { symbol: false })}</td>
              <td className="table-td num">{pkr(it.totalValues, { symbol: false })}</td>
              <td className="table-td text-xs">
                {it.fbr.itemInvoiceNo ? <span className="font-mono">{it.fbr.itemInvoiceNo}</span> : it.fbr.statusCode ? <span className={it.fbr.statusCode === '00' ? 'text-emerald-700' : 'text-red-700'}>{it.fbr.statusCode} {it.fbr.errorCode ? `[${it.fbr.errorCode}]` : ''} {it.fbr.error ?? ''}</span> : '—'}
              </td>
            </tr>
          ))}
        </Table>
        <div className="grid gap-1 border-t border-ink-100 p-4 text-sm sm:ml-auto sm:max-w-sm">
          {[
            ['Value excl. sales tax', t.valueExclST],
            ['Sales tax', t.salesTax],
            ['Further tax', t.furtherTax],
            ['Extra tax', t.extraTax],
            ['FED payable', t.fed],
            ['ST withheld at source', t.withheld],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4"><span className="text-ink-500">{k}</span><span className="tabular-nums">{pkr(v)}</span></div>
          ))}
          <div className="flex justify-between gap-4 border-t border-ink-100 pt-1 font-semibold"><span>Grand total</span><span className="tabular-nums">{pkr(t.grandTotal)}</span></div>
          <div className="flex justify-between gap-4 text-xs text-ink-500"><span>Net receivable</span><span className="tabular-nums">{pkr(t.netReceivable)}</span></div>
        </div>
      </Card>
      <Card title={`FBR attempt history (${attempts.length})`}>
        {attempts.length === 0 ? (
          <EmptyState title="This invoice has not been sent to FBR" />
        ) : (
          <ol className="space-y-3">
            {attempts.map((a) => (
              <li key={a.id} className="rounded-xl border border-ink-200 p-3">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge tone={a.operation === 'POST' ? 'violet' : 'blue'}>{a.operation}</Badge>
                  <Badge tone={OUTCOME_TONE[a.outcome] ?? 'gray'}>{human(a.outcome)}</Badge>
                  <span className="text-xs text-ink-500">HTTP {a.httpStatus ?? '—'} · {a.durationMs ?? '—'} ms · {dateTime(a.startedAt)} · by {human(a.initiatedKind)}</span>
                  {a.fbrInvoiceNo && <span className="font-mono text-xs">FBR {a.fbrInvoiceNo}</span>}
                </div>
                <p className="mt-1 break-all font-mono text-[11px] text-ink-500">{a.url}</p>
                <IssueList issues={a.issues} />
                <div className="mt-2 grid gap-2 lg:grid-cols-2">
                  <details>
                    <summary className="cursor-pointer text-xs font-medium text-brand-700">Request sent (no credentials are stored)</summary>
                    <pre className="mt-1 max-h-80 overflow-auto rounded bg-ink-900 p-2 text-[11px] text-ink-50">{prettyJson(a.requestBody) || '—'}</pre>
                  </details>
                  <details>
                    <summary className="cursor-pointer text-xs font-medium text-brand-700">Raw FBR response</summary>
                    <pre className="mt-1 max-h-80 overflow-auto rounded bg-ink-900 p-2 text-[11px] text-ink-50">{prettyJson(a.responseBody) || '—'}</pre>
                  </details>
                </div>
              </li>
            ))}
          </ol>
        )}
      </Card>
      <Dialog
        open={retryOpen}
        onClose={() => setRetryOpen(false)}
        title="Controlled retry"
        footer={
          <>
            <Button variant="secondary" onClick={() => setRetryOpen(false)}>Cancel</Button>
            <Button onClick={() => retry.mutate()} loading={retry.isPending} disabled={reason.trim().length < 5}>Submit to FBR now</Button>
          </>
        }
      >
        <Alert tone="amber">
          This submits the invoice to the FBR {inv.environment === 'PRODUCTION' ? 'production' : 'sandbox'} endpoint on behalf of the business. It is allowed only because the previous attempt definitely did not reach FBR. The current-month rule and buyer registration checks are re-applied; uncertain outcomes are never retried automatically.
        </Alert>
        {retry.error && <ErrorBanner error={retry.error} />}
        <TextArea label="Reason (recorded in the audit log)" required rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Dialog>
    </div>
  );
}
