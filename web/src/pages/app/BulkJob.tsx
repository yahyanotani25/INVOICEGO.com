import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { api, download } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { pkr } from '@/lib/format';
import { Alert, Badge, Button, Card, ConfirmDialog, EnvBadge, ErrorBanner, PageHeader, Spinner, Table, useToast } from '@/components/ui';

interface RowIssue { importRef: string; row: number; field: string; level: string; message: string; fbrCode?: string }
interface ImportInvoice { id: string; importRef: string; rowNumbers: number[]; status: string; invoiceId: string | null; data: { invoiceDate: string; buyerBusinessName: string; buyerRegistrationType: string | null; items: unknown[] }; errors: RowIssue[]; warnings: RowIssue[]; fbrResult: { outcome?: string; fbrInvoiceNumber?: string } | null; invoice: { id: string; internalNumber: string; status: string; fbrInvoiceNumber: string | null; grandTotal: string } | null }
interface JobDetail { id: string; filename: string; environment: string; status: string; totalInvoices: number; totalRows: number; fileErrors: RowIssue[]; counts: Record<string, number>; invoices: ImportInvoice[]; running: { id: string; type: string; status: string; progress: { done?: number; total?: number } }[] }

const TONE: Record<string, 'green' | 'red' | 'amber' | 'blue' | 'gray'> = { READY: 'blue', DRAFT_CREATED: 'blue', FBR_VALID: 'green', ACCEPTED: 'green', LOCAL_INVALID: 'red', FBR_INVALID: 'red', REJECTED: 'red', ERROR: 'red', RECONCILIATION_REQUIRED: 'amber', NOT_SENT: 'amber', SKIPPED_DUPLICATE: 'gray' };

export default function BulkJob() {
  const { id } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const { can } = useAuth();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [filter, setFilter] = useState('');
  const q = useQuery({
    queryKey: ['bulk-job', id],
    queryFn: () => api<JobDetail>(`/api/app/bulk/jobs/${id}`),
    refetchInterval: (query) => ((query.state.data as JobDetail | undefined)?.running.length ? 1500 : false),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['bulk-job', id] });
  const drafts = useMutation({ mutationFn: (refs: string[] | 'ALL_READY') => api<{ results: { ok: boolean }[] }>(`/api/app/bulk/jobs/${id}/drafts`, { body: { refs } }), onSuccess: (r) => { toast('green', `${r.results.filter((x) => x.ok).length} draft(s) created`); refresh(); } });
  const queue = useMutation({
    mutationFn: ({ kind, refs }: { kind: 'validate' | 'submit'; refs: string[] }) => api<{ queued: number; skipped: number }>(`/api/app/bulk/jobs/${id}/${kind}`, { body: { refs } }),
    onSuccess: (r, v) => { toast('blue', `${r.queued} invoice(s) queued for FBR ${v.kind === 'validate' ? 'validation' : 'submission'}${r.skipped ? `, ${r.skipped} skipped (not eligible)` : ''}`); setSel(new Set()); refresh(); },
  });
  // Serverless hosts have no background worker: while a run is queued, this page drives it in
  // time slices. On a VM the worker may pick it up first; claims are atomic either way.
  const driving = useRef(false);
  useEffect(() => {
    const r = q.data?.running[0];
    if (!r || r.status !== 'QUEUED' || driving.current || !can('submit')) return;
    driving.current = true;
    api(`/api/app/bulk/jobs/${id}/process`, { body: {} })
      .catch(() => undefined)
      .finally(() => {
        driving.current = false;
        void refresh();
      });
  }, [q.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = useMemo(() => (q.data?.invoices ?? []).filter((r) => !filter || r.status === filter), [q.data, filter]);
  if (q.isLoading) return <Spinner />;
  if (!q.data) return <ErrorBanner error={q.error} />;
  const J = q.data;
  const running = J.running[0];
  const refsWith = (statuses: string[]) => J.invoices.filter((r) => statuses.includes(r.status) && (sel.size === 0 || sel.has(r.importRef))).map((r) => r.importRef);
  const toggle = (ref: string) => setSel((s) => { const n = new Set(s); n.has(ref) ? n.delete(ref) : n.add(ref); return n; });

  return (
    <div className="space-y-5">
      <PageHeader title={J.filename} subtitle={<span className="flex flex-wrap items-center gap-2"><EnvBadge env={J.environment} />{J.totalInvoices} invoices · {J.totalRows} rows · {J.status}</span>} actions={<Button variant="secondary" onClick={() => download(`/api/app/bulk/jobs/${id}/errors.xlsx`, 'errors.xlsx').catch((e) => toast('red', e.message))}><Download className="h-4 w-4" /> Error report</Button>} />
      <ol className="flex flex-wrap gap-2 text-xs text-ink-600" aria-label="Workflow">
        {['Upload', 'Parse', 'Preview', 'Local validation', 'FBR validation', 'Review', 'Submit'].map((s, i) => <li key={s} className="rounded-full bg-white px-3 py-1 ring-1 ring-ink-200">{i + 1}. {s}</li>)}
      </ol>
      {J.fileErrors.length > 0 && <Alert tone={J.fileErrors.some((f) => f.level === 'error') ? 'red' : 'amber'} title="File-level messages">{J.fileErrors.map((f, k) => <div key={k}>{f.row ? `Row ${f.row}: ` : ''}{f.message}</div>)}</Alert>}
      {running && <Alert tone="blue" title={`${running.type === 'bulk.validate' ? 'Validating with FBR' : 'Submitting to FBR'}… ${running.progress.done ?? 0} / ${running.progress.total ?? '?'}`}>Each invoice is processed and reported separately. Keep this page open until the run finishes.</Alert>}
      <div className="flex flex-wrap gap-2">{Object.entries(J.counts).map(([k, v]) => <button key={k} onClick={() => setFilter(filter === k ? '' : k)}><Badge tone={TONE[k] ?? 'gray'} className={filter === k ? 'ring-2' : ''}>{k.replace(/_/g, ' ').toLowerCase()}: {v}</Badge></button>)}</div>
      {can('write') && (
        <Card title="Actions" bodyClass="flex flex-wrap items-center gap-2 p-4">
          <span className="mr-2 text-sm text-ink-600">{sel.size ? `${sel.size} selected` : 'Applies to all eligible invoices'}</span>
          <Button variant="secondary" onClick={() => drafts.mutate(sel.size ? refsWith(['READY']) : 'ALL_READY')} loading={drafts.isPending} disabled={!J.invoices.some((r) => r.status === 'READY')}>Save ready invoices as drafts</Button>
          <Button variant="secondary" onClick={() => queue.mutate({ kind: 'validate', refs: refsWith(['DRAFT_CREATED', 'FBR_INVALID', 'FBR_VALID', 'NOT_SENT']) })} loading={queue.isPending} disabled={!!running || refsWith(['DRAFT_CREATED', 'FBR_INVALID', 'FBR_VALID', 'NOT_SENT']).length === 0}>Validate with FBR</Button>
          <Button onClick={() => setConfirmSubmit(true)} disabled={!!running || refsWith(['FBR_VALID', 'NOT_SENT']).length === 0}>Submit validated to FBR</Button>
          <ErrorBanner error={drafts.error ?? queue.error} />
        </Card>
      )}
      <Card bodyClass="p-0">
        <Table head={<tr><th className="table-th w-8"><span className="sr-only">Select</span></th><th className="table-th">Import ref / rows</th><th className="table-th">Buyer · date</th><th className="table-th">Status</th><th className="table-th">Errors & warnings</th><th className="table-th">Invoice</th></tr>}>
          {rows.map((r) => (
            <tr key={r.id} className="align-top">
              <td className="table-td"><input type="checkbox" aria-label={`Select ${r.importRef}`} checked={sel.has(r.importRef)} onChange={() => toggle(r.importRef)} /></td>
              <td className="table-td"><span className="font-mono font-medium">{r.importRef}</span><div className="text-xs text-ink-500">rows {r.rowNumbers.join(', ')} · {r.data.items.length} item(s)</div></td>
              <td className="table-td">{r.data.buyerBusinessName}<div className="text-xs text-ink-500">{r.data.invoiceDate} · {r.data.buyerRegistrationType ?? '—'}</div></td>
              <td className="table-td"><Badge tone={TONE[r.status] ?? 'gray'}>{r.status.replace(/_/g, ' ').toLowerCase()}</Badge></td>
              <td className="table-td max-w-md text-xs">
                {r.errors.map((e, k) => <div key={k} className="text-red-700">Row {e.row} · {e.field}{e.fbrCode ? ` · FBR ${e.fbrCode}` : ''}: {e.message}</div>)}
                {r.warnings.map((e, k) => <div key={k} className="text-amber-700">Row {e.row} · {e.field}: {e.message}</div>)}
                {!r.errors.length && !r.warnings.length && <span className="text-ink-400">—</span>}
              </td>
              <td className="table-td text-xs">{r.invoice ? <><Link className="text-brand-700 hover:underline" to={`/app/invoices/${r.invoice.id}`}>{r.invoice.internalNumber}</Link><div>{pkr(r.invoice.grandTotal)}</div>{r.invoice.fbrInvoiceNumber && <div className="font-mono text-emerald-700">{r.invoice.fbrInvoiceNumber}</div>}</> : '—'}</td>
            </tr>
          ))}
        </Table>
      </Card>
      <ConfirmDialog
        open={confirmSubmit}
        onClose={() => setConfirmSubmit(false)}
        title={`Submit ${refsWith(['FBR_VALID', 'NOT_SENT']).length} invoice(s) to FBR ${J.environment === 'PRODUCTION' ? 'PRODUCTION' : 'sandbox'}?`}
        danger={J.environment === 'PRODUCTION'}
        confirmLabel="Submit"
        onConfirm={() => { setConfirmSubmit(false); queue.mutate({ kind: 'submit', refs: refsWith(['FBR_VALID', 'NOT_SENT']) }); }}
        message="Only invoices that passed FBR validation are submitted. Invoices already accepted are never resubmitted. Each result is reported per invoice."
      />
    </div>
  );
}
