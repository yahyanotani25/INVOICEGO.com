import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Download, Edit3, FileCheck2, Printer, Send, Trash2 } from 'lucide-react';
import { api, ApiError, download } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { dateOnly, dateTime, pkr, qty, regLabel, STATUS_LABEL, STATUS_TONE, typeLabel } from '@/lib/format';
import type { ExplainedIssue, FbrActionResult, Invoice } from '@/lib/types';
import { Alert, Badge, Button, Card, ConfirmDialog, Dialog, EnvBadge, ErrorBanner, PageHeader, Spinner, Table, TextArea, TextInput, useToast } from '@/components/ui';
import { FbrResult, OutcomeBadge, prettify } from '@/components/FbrResult';

interface Attempt {
  id: string;
  operation: string;
  environment: string;
  url: string;
  httpStatus: number | null;
  outcome: string;
  fbrInvoiceNo: string | null;
  startedAt: string;
  durationMs: number | null;
  requestBody: string | null;
  responseBody: string | null;
  errorMessage: string | null;
  issues: ExplainedIssue[];
}

export default function InvoiceView() {
  const { id } = useParams();
  const [sp, setSp] = useSearchParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const { can } = useAuth();
  const q = useQuery({ queryKey: ['invoice', id], queryFn: () => api<Invoice>(`/api/app/invoices/${id}`) });
  const attempts = useQuery({ queryKey: ['attempts', id], queryFn: () => api<Attempt[]>(`/api/app/invoices/${id}/attempts`) });
  const payload = useQuery({ queryKey: ['payload', id], queryFn: () => api<{ payload: string; source: string }>(`/api/app/invoices/${id}/payload`) });
  const [result, setResult] = useState<{ op: 'VALIDATE' | 'POST'; r: FbrActionResult } | null>(null);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [reconcile, setReconcile] = useState<null | 'ACCEPTED' | 'NOT_RECORDED'>(null);
  const autoRan = useRef(false);

  const refresh = async () => {
    await Promise.all([qc.invalidateQueries({ queryKey: ['invoice', id] }), qc.invalidateQueries({ queryKey: ['attempts', id] }), qc.invalidateQueries({ queryKey: ['payload', id] }), qc.invalidateQueries({ queryKey: ['invoices'] })]);
  };
  const act = useMutation({
    mutationFn: async (op: 'VALIDATE' | 'POST') => ({ op, r: await api<FbrActionResult>(`/api/app/invoices/${id}/${op === 'VALIDATE' ? 'validate' : 'submit'}`, { body: {} }) }),
    onSuccess: async (x) => {
      setResult(x);
      qc.setQueryData(['invoice', id], x.r.invoice);
      await refresh();
      toast(x.r.outcome === 'VALID' ? 'green' : 'amber', `${x.op === 'POST' ? 'Submission' : 'Validation'} outcome: ${x.r.outcome}`);
    },
    onError: async () => {
      await refresh();
    },
  });
  const dup = useMutation({
    mutationFn: () => api<{ invoice: Invoice; note: string }>(`/api/app/invoices/${id}/duplicate`, { body: {} }),
    onSuccess: (r) => {
      toast('green', r.note);
      nav(`/app/invoices/${r.invoice.id}/edit`);
    },
  });
  const del = useMutation({
    mutationFn: () => api(`/api/app/invoices/${id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['invoices'] });
      toast('green', 'Draft deleted');
      nav('/app/invoices');
    },
  });

  useEffect(() => {
    if (sp.get('action') === 'validate' && q.data && !autoRan.current && ['DRAFT', 'VALIDATION_FAILED', 'REJECTED', 'VALIDATED'].includes(q.data.status)) {
      autoRan.current = true;
      setSp({}, { replace: true });
      act.mutate('VALIDATE');
    }
  }, [sp, q.data]); // eslint-disable-line react-hooks/exhaustive-deps

  if (q.isLoading) return <Spinner />;
  if (!q.data) return <ErrorBanner error={q.error} />;
  const inv = q.data;
  const editable = ['DRAFT', 'VALIDATED', 'VALIDATION_FAILED', 'REJECTED'].includes(inv.status);
  const canSubmit = inv.status === 'VALIDATED' && inv.validated;
  const lastUncertain = attempts.data?.find((a) => a.operation === 'POST');

  return (
    <div className="space-y-5">
      <PageHeader
        title={`${typeLabel(inv.invoiceType)} ${inv.internalNumber}`}
        subtitle={<span className="flex flex-wrap items-center gap-2"><EnvBadge env={inv.environment} /><Badge tone={STATUS_TONE[inv.status]}>{STATUS_LABEL[inv.status] ?? inv.status}</Badge>{inv.scenarioId && <Badge tone="violet">{inv.scenarioId}</Badge>}<span>Dated {dateOnly(inv.invoiceDate)} {inv.invoiceTime}</span></span>}
        actions={
          <>
            {editable && can('write') && (
              <Link to={`/app/invoices/${id}/edit`}>
                <Button variant="secondary"><Edit3 className="h-4 w-4" /> Edit</Button>
              </Link>
            )}
            {editable && can('submit') && (
              <Button variant="secondary" onClick={() => act.mutate('VALIDATE')} loading={act.isPending && act.variables === 'VALIDATE'} disabled={act.isPending}>
                <FileCheck2 className="h-4 w-4" /> Validate with FBR
              </Button>
            )}
            {can('submit') && inv.status !== 'ACCEPTED' && inv.status !== 'RECONCILIATION_REQUIRED' && (
              <Button onClick={() => setConfirmSubmit(true)} disabled={!canSubmit || act.isPending} title={canSubmit ? '' : 'Validate first'}>
                <Send className="h-4 w-4" /> Submit to FBR
              </Button>
            )}
            <Link to={`/app/invoices/${id}/print`} target="_blank">
              <Button variant="secondary"><Printer className="h-4 w-4" /> Print</Button>
            </Link>
            <Button variant="secondary" onClick={() => download(`/api/app/invoices/${id}/pdf`, `${inv.internalNumber}.pdf`).catch((e) => toast('red', e.message))}>
              <Download className="h-4 w-4" /> PDF
            </Button>
            {can('write') && (
              <Button variant="secondary" onClick={() => dup.mutate()} loading={dup.isPending}>
                <Copy className="h-4 w-4" /> Duplicate
              </Button>
            )}
            {['DRAFT', 'VALIDATION_FAILED', 'VALIDATED'].includes(inv.status) && can('write') && (
              <Button variant="ghost" onClick={() => setConfirmDelete(true)} aria-label="Delete draft">
                <Trash2 className="h-4 w-4 text-red-600" />
              </Button>
            )}
          </>
        }
      />

      {act.error && (
        <ErrorBanner error={act.error} />
      )}
      {act.error instanceof ApiError && act.error.code === 'BUYER_REGISTRATION_MISMATCH' && (
        <Alert tone="red" title="Buyer type mismatch">
          Edit the invoice and change the buyer type as instructed, then validate again.
        </Alert>
      )}
      {result && <Card title="Latest FBR response"><FbrResult op={result.op} outcome={result.r.outcome} httpStatus={result.r.httpStatus} issues={result.r.issues} raw={result.r.rawResponse} /></Card>}
      {result?.r.buyerCheck?.result === 'UNAVAILABLE' && <Alert tone="amber">{result.r.buyerCheck.message} The invoice was not treated as unregistered.</Alert>}

      {inv.status === 'ACCEPTED' && (
        <Alert tone="green" title={`Accepted by FBR — ${inv.fbrInvoiceNumber}`}>
          FBR timestamp {inv.fbrDated ?? '—'}. {inv.acceptedViaReconcile ? 'Recorded through reconciliation with the IRIS Invoice Dashboard.' : ''} This invoice is locked and cannot be edited or resubmitted.
          {inv.environment === 'SANDBOX' && ' Sandbox invoice — not a production tax invoice.'}
        </Alert>
      )}
      {inv.status === 'RECONCILIATION_REQUIRED' && (
        <Alert tone="amber" title="Reconciliation required — do not resubmit blindly">
          <p>{inv.reconciliationNote}</p>
          <p className="mt-1">Check the IRIS Digital Invoicing → Invoice Dashboard for this invoice (date {inv.invoiceDate}, buyer {inv.buyerBusinessName}, value {pkr(inv.totals.grandTotal)}). The FBR system does not retry automatically.</p>
          {can('submit') && (
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" onClick={() => setReconcile('ACCEPTED')}>It is in IRIS — record the FBR number</Button>
              <Button size="sm" variant="secondary" onClick={() => setReconcile('NOT_RECORDED')}>It is NOT in IRIS — allow a controlled reattempt</Button>
            </div>
          )}
        </Alert>
      )}
      {inv.status === 'VALIDATED' && <Alert tone="blue">Validated with FBR {dateTime(inv.lastValidatedAt)}. Any change will require validating again before submission.</Alert>}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Seller">
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <dt className="text-ink-500">Name</dt><dd>{inv.seller.businessName}</dd>
            <dt className="text-ink-500">NTN/CNIC</dt><dd>{inv.seller.ntnCnic}</dd>
            <dt className="text-ink-500">Province</dt><dd>{inv.seller.province}</dd>
            <dt className="text-ink-500">Address</dt><dd>{inv.seller.address}</dd>
          </dl>
        </Card>
        <Card title="Buyer">
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <dt className="text-ink-500">Name</dt><dd>{inv.buyerBusinessName}</dd>
            <dt className="text-ink-500">NTN/CNIC</dt><dd>{inv.buyerNtnCnic || '—'}</dd>
            <dt className="text-ink-500">Province</dt><dd>{inv.buyerProvince}</dd>
            <dt className="text-ink-500">Address</dt><dd>{inv.buyerAddress}</dd>
            <dt className="text-ink-500">Type</dt><dd>{regLabel(inv.buyerRegistrationType)}</dd>
            <dt className="text-ink-500">FBR check</dt><dd>{inv.buyerCheck.result === 'NOT_CHECKED' ? 'Not checked' : `${inv.buyerCheck.result} · ${dateTime(inv.buyerCheck.checkedAt)}`}</dd>
          </dl>
        </Card>
      </div>

      <Card title="Items" bodyClass="p-0">
        <Table head={<tr>{['#', 'HS code', 'Description', 'Sale type', 'Rate', 'Qty', 'UOM', 'Unit price', 'Discount', 'Value excl. ST', 'Sales tax', 'Further', 'Total', 'FBR'].map((x) => <th key={x} className="table-th">{x}</th>)}</tr>}>
          {inv.items.map((it) => (
            <tr key={it.id}>
              <td className="table-td">{it.lineNo}</td>
              <td className="table-td font-mono">{it.hsCode}</td>
              <td className="table-td">{it.productDescription}</td>
              <td className="table-td text-xs">{it.saleType}</td>
              <td className="table-td">{it.rate}</td>
              <td className="table-td num">{qty(it.quantity)}</td>
              <td className="table-td text-xs">{it.uom}</td>
              <td className="table-td num">{pkr(it.unitPrice, { symbol: false })}</td>
              <td className="table-td num">{pkr(it.discount, { symbol: false })}</td>
              <td className="table-td num">{pkr(it.valueSalesExcludingST, { symbol: false })}</td>
              <td className="table-td num">{pkr(it.salesTaxApplicable, { symbol: false })}</td>
              <td className="table-td num">{pkr(it.furtherTax, { symbol: false })}</td>
              <td className="table-td num font-medium">{pkr(it.totalValues, { symbol: false })}</td>
              <td className="table-td text-xs">{it.fbr?.itemInvoiceNo ?? (it.fbr?.error ? <span className="text-red-700">{it.fbr.errorCode} {it.fbr.error}</span> : '—')}</td>
            </tr>
          ))}
        </Table>
        <div className="grid gap-2 border-t border-ink-100 p-4 text-sm sm:grid-cols-3 lg:grid-cols-6">
          {[['Value excl. ST', inv.totals.valueExclST], ['Sales tax', inv.totals.salesTax], ['Further tax', inv.totals.furtherTax], ['Extra tax', inv.totals.extraTax], ['FED', inv.totals.fed], ['ST withheld', inv.totals.withheld]].map(([k, v]) => (
            <div key={k}><p className="text-xs text-ink-500">{k}</p><p className="tabular-nums">{pkr(v)}</p></div>
          ))}
          <div className="sm:col-span-3 lg:col-span-6 flex flex-wrap justify-between border-t border-ink-100 pt-2">
            <span className="font-semibold">Grand total {pkr(inv.totals.grandTotal)}</span>
            <span className="text-ink-600">Net receivable {pkr(inv.totals.netReceivable)} · Payment mode {inv.paymentMode ?? '—'}</span>
          </div>
        </div>
      </Card>

      <Card title={`Request ${payload.data?.source === 'accepted snapshot' ? '(accepted snapshot — immutable)' : 'preview (exact JSON that will be sent)'}`}>
        <pre className="max-h-96 overflow-auto rounded-lg bg-ink-900 p-3 text-[11px] text-ink-100">{payload.data?.payload ?? '…'}</pre>
      </Card>

      <Card title="FBR attempt history" bodyClass="p-0">
        {!attempts.data?.length ? (
          <p className="p-4 text-sm text-ink-500">No FBR calls yet.</p>
        ) : (
          <ul className="divide-y divide-ink-100">
            {attempts.data.map((a) => (
              <AttemptRow key={a.id} a={a} />
            ))}
          </ul>
        )}
      </Card>

      <ConfirmDialog
        open={confirmSubmit}
        onClose={() => setConfirmSubmit(false)}
        title={`Submit to FBR ${inv.environment === 'PRODUCTION' ? 'PRODUCTION' : 'sandbox'}?`}
        confirmLabel={inv.environment === 'PRODUCTION' ? 'Submit to FBR production' : 'Submit to sandbox'}
        danger={inv.environment === 'PRODUCTION'}
        loading={act.isPending}
        onConfirm={() => {
          setConfirmSubmit(false);
          act.mutate('POST');
        }}
        message={inv.environment === 'PRODUCTION' ? 'This sends a real tax invoice to FBR. Once accepted it cannot be changed or resubmitted.' : 'This sends the invoice to the FBR sandbox (testing only).'}
      />
      <ConfirmDialog open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Delete draft?" danger confirmLabel="Delete" loading={del.isPending} onConfirm={() => del.mutate()} message="Drafts that were never submitted to FBR can be deleted. This cannot be undone." />
      <ReconcileDialog mode={reconcile} onClose={() => setReconcile(null)} invoiceId={id!} suggested={lastUncertain?.fbrInvoiceNo ?? ''} onDone={refresh} />
    </div>
  );
}

function AttemptRow({ a }: { a: Attempt }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="p-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge tone="gray">{a.operation}</Badge>
        <OutcomeBadge outcome={a.outcome} />
        <span className="text-ink-500">HTTP {a.httpStatus ?? '—'} · {a.durationMs ?? '—'} ms · {dateTime(a.startedAt)}</span>
        {a.fbrInvoiceNo && <Badge tone="green">{a.fbrInvoiceNo}</Badge>}
        <button className="ml-auto text-xs text-brand-700 hover:underline" onClick={() => setOpen(!open)}>{open ? 'Hide details' : 'Details'}</button>
      </div>
      {open && (
        <div className="mt-3 space-y-2">
          <p className="break-all text-xs text-ink-500">{a.url}</p>
          {a.errorMessage && <p className="text-xs text-amber-700">{a.errorMessage}</p>}
          <FbrResult op={a.operation === 'POST' ? 'POST' : 'VALIDATE'} outcome={a.outcome} httpStatus={a.httpStatus} issues={a.issues} raw={a.responseBody ? prettify(a.responseBody) : null} request={a.requestBody} />
        </div>
      )}
    </li>
  );
}

function ReconcileDialog({ mode, onClose, invoiceId, suggested, onDone }: { mode: null | 'ACCEPTED' | 'NOT_RECORDED'; onClose: () => void; invoiceId: string; suggested: string; onDone: () => Promise<void> }) {
  const [num, setNum] = useState(suggested);
  const [note, setNote] = useState('');
  const m = useMutation({
    mutationFn: () => api(`/api/app/invoices/${invoiceId}/reconcile`, { body: mode === 'ACCEPTED' ? { resolution: 'ACCEPTED', fbrInvoiceNumber: num, note } : { resolution: 'NOT_RECORDED', note } }),
    onSuccess: async () => {
      await onDone();
      onClose();
    },
  });
  return (
    <Dialog
      open={!!mode}
      onClose={onClose}
      title={mode === 'ACCEPTED' ? 'Record FBR acceptance from IRIS' : 'Confirm FBR did not record this invoice'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={() => m.mutate()} loading={m.isPending}>Confirm</Button></>}
    >
      <ErrorBanner error={m.error} />
      {mode === 'ACCEPTED' ? (
        <TextInput label="FBR invoice number (exactly as in IRIS)" required value={num} onChange={(e) => setNum(e.target.value.trim())} hint="e.g. 7000007DI1747119701593" />
      ) : (
        <Alert tone="amber">The invoice returns to draft. It must be validated again and pass the current-month rule before a new submission.</Alert>
      )}
      <TextArea label="Reconciliation note" required rows={3} value={note} onChange={(e) => setNote(e.target.value)} hint="How you checked (e.g. IRIS Invoice Dashboard search on date/buyer)" />
    </Dialog>
  );
}
