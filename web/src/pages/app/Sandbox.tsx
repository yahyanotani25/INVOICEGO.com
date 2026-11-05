import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { CheckCircle2, Circle, CircleDashed, RotateCcw, XCircle } from 'lucide-react';
import { api, ApiError, type Issue } from '@/lib/api';
import { dateTime } from '@/lib/format';
import type { ExplainedIssue, FbrActionResult, Invoice, Lookups } from '@/lib/types';
import { MONTH_RULE_MESSAGE } from '@/lib/types';
import { Alert, Badge, Button, Card, EnvBadge, ErrorBanner, PageHeader, Spinner, Tabs, useToast } from '@/components/ui';
import { FbrResult, OutcomeBadge, prettify } from '@/components/FbrResult';

interface ScenarioRow {
  id: string;
  description: string;
  saleTypeLabel: string;
  saleTypeApi: string;
  retailerOnly: boolean;
  purchaseType: boolean;
  templateTitle: string | null;
  templateAnomalies: string[];
  applicability: { status: 'REQUIRED' | 'CONDITIONAL_NOT_MET' | 'NOT_APPLICABLE'; reasons: string[]; rows: number[] };
  progress: { status: string; attempts: number; lastAttemptAt?: string; lastOutcome?: string; passedAt?: string; passedFbrNumber?: string; passedInvoiceId?: string };
}
interface ScenarioList {
  profile: { businessActivities: string[]; sector: string; retailerRegistered: boolean; officialScenarioIds: string[] };
  summary: { required: number; passed: number; remaining: string[] };
  applicability: { required: string[]; computedRequired: string[]; usedOfficial: boolean; officialDiff: { onlyOfficial: string[]; onlyComputed: string[] } | null; missingCombinations: string[]; notes: string[] };
  scenarios: ScenarioRow[];
}
interface TemplateResp {
  scenarioId: string;
  title: string;
  label: string;
  source: string;
  original: { raw: string; json: unknown; anomalies: string[] };
  prepared: Json;
  changes: { field: string; from: unknown; to: unknown; reason: string }[];
  warnings: string[];
  latestInvoice: Invoice | null;
}
type Json = Record<string, any>;
interface AttemptRow { id: string; operation: string; invoiceId: string | null; internalNumber?: string; httpStatus: number | null; outcome: string; fbrInvoiceNo: string | null; startedAt: string; durationMs: number | null; requestBody: string | null; responseBody: string | null; issues: ExplainedIssue[] }

const HEADER_FIELDS: { k: string; label: string; readOnly?: boolean; note?: string }[] = [
  { k: 'invoiceType', label: 'invoiceType' },
  { k: 'invoiceDate', label: 'invoiceDate' },
  { k: 'sellerNTNCNIC', label: 'sellerNTNCNIC', readOnly: true, note: 'from profile' },
  { k: 'sellerBusinessName', label: 'sellerBusinessName', readOnly: true, note: 'from profile' },
  { k: 'sellerProvince', label: 'sellerProvince', readOnly: true, note: 'from profile' },
  { k: 'sellerAddress', label: 'sellerAddress', readOnly: true, note: 'from profile' },
  { k: 'buyerNTNCNIC', label: 'buyerNTNCNIC' },
  { k: 'buyerBusinessName', label: 'buyerBusinessName' },
  { k: 'buyerProvince', label: 'buyerProvince' },
  { k: 'buyerAddress', label: 'buyerAddress' },
  { k: 'buyerRegistrationType', label: 'buyerRegistrationType' },
  { k: 'invoiceRefNo', label: 'invoiceRefNo' },
  { k: 'scenarioId', label: 'scenarioId', readOnly: true, note: 'fixed for this scenario' },
];
const ITEM_FIELDS = ['hsCode', 'productDescription', 'rate', 'uoM', 'quantity', 'totalValues', 'valueSalesExcludingST', 'fixedNotifiedValueOrRetailPrice', 'salesTaxApplicable', 'salesTaxWithheldAtSource', 'extraTax', 'furtherTax', 'sroScheduleNo', 'fedPayable', 'discount', 'saleType', 'sroItemSerialNo'];
const NUMERIC = new Set(['quantity', 'totalValues', 'valueSalesExcludingST', 'fixedNotifiedValueOrRetailPrice', 'salesTaxApplicable', 'salesTaxWithheldAtSource', 'extraTax', 'furtherTax', 'fedPayable', 'discount']);

const STATUS_ICON = { PASSED: CheckCircle2, FAILED: XCircle, NOT_STARTED: Circle } as Record<string, typeof Circle>;

export default function Sandbox() {
  const qc = useQueryClient();
  const [sp, setSp] = useSearchParams();
  const list = useQuery({ queryKey: ['scenario-list'], queryFn: () => api<ScenarioList>('/api/app/sandbox/scenarios') });
  const creds = useQuery({ queryKey: ['fbr-creds'], queryFn: () => api<{ credentials: { environment: string; tokenSaved: boolean; status: string }[] }>('/api/app/fbr/credentials') });
  const [filter, setFilter] = useState<'required' | 'all'>('required');
  const selected = sp.get('s') ?? '';

  useEffect(() => {
    if (!selected && list.data) {
      const first = list.data.scenarios.find((s) => s.applicability.status === 'REQUIRED' && s.progress.status !== 'PASSED') ?? list.data.scenarios[0];
      if (first) setSp({ s: first.id }, { replace: true });
    }
  }, [list.data, selected, setSp]);

  if (list.isLoading) return <Spinner />;
  if (!list.data) return <ErrorBanner error={list.error} />;
  const L = list.data;
  const sandboxCred = creds.data?.credentials.find((c) => c.environment === 'SANDBOX');
  const rows = L.scenarios.filter((s) => filter === 'all' || s.applicability.status === 'REQUIRED');

  return (
    <div className="space-y-5">
      <PageHeader
        title="Sandbox scenario testing"
        subtitle={<>Load a supplied scenario, edit it, then validate and submit it to the real FBR sandbox with your own token. A scenario only counts as passed after a genuinely accepted sandbox submission.</>}
        actions={<EnvBadge env="SANDBOX" />}
      />
      {!sandboxCred?.tokenSaved && (
        <Alert tone="amber" title="Sandbox token not configured">
          Add the sandbox token from IRIS (Digital Invoicing → Sandbox Environment) under <Link className="underline" to="/app/fbr">FBR integration</Link>. Requests are only ever sent with your real credentials — nothing is simulated.
        </Alert>
      )}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="card p-4">
          <p className="text-xs uppercase text-ink-500">Required scenarios passed</p>
          <p className="mt-1 text-2xl font-semibold">{L.summary.passed} / {L.summary.required}</p>
          <div className="mt-2 h-2 rounded bg-ink-100"><div className="h-2 rounded bg-emerald-500" style={{ width: `${L.summary.required ? (L.summary.passed / L.summary.required) * 100 : 0}%` }} /></div>
        </div>
        <div className="card p-4 text-sm sm:col-span-2">
          <p className="text-xs uppercase text-ink-500">Applicability basis</p>
          <p className="mt-1">Business nature: <strong>{L.profile.businessActivities.join(', ')}</strong> · Sector: <strong>{L.profile.sector}</strong> · Retailer registration: <strong>{L.profile.retailerRegistered ? 'Yes' : 'No'}</strong></p>
          <p className="mt-1 text-xs text-ink-500">{L.applicability.usedOfficial ? 'Using the official IRIS assignment you recorded.' : 'Computed from the complete applicability matrix in the DI API spec v1.12 §10.'} <Link className="text-brand-700 underline" to="/app/settings">Change profile / record IRIS assignment</Link></p>
          {L.applicability.officialDiff && (L.applicability.officialDiff.onlyOfficial.length > 0 || L.applicability.officialDiff.onlyComputed.length > 0) && (
            <p className="mt-1 text-xs text-amber-700">Differences vs. matrix — only in IRIS: {L.applicability.officialDiff.onlyOfficial.join(', ') || '—'}; only in matrix: {L.applicability.officialDiff.onlyComputed.join(', ') || '—'}</p>
          )}
          {L.applicability.notes.map((n) => <p key={n} className="mt-1 text-xs text-amber-700">Source note: {n}</p>)}
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
        <Card title="Scenarios" actions={<select className="input py-1 text-xs" value={filter} onChange={(e) => setFilter(e.target.value as 'all' | 'required')} aria-label="Filter scenarios"><option value="required">Required for me</option><option value="all">All 28</option></select>} bodyClass="p-0">
          <ul className="max-h-[70vh] divide-y divide-ink-100 overflow-y-auto">
            {rows.map((s) => {
              const Icon = STATUS_ICON[s.progress.status] ?? CircleDashed;
              return (
                <li key={s.id}>
                  <button onClick={() => setSp({ s: s.id })} className={clsx('flex w-full items-start gap-2 px-3 py-2.5 text-left hover:bg-ink-50', selected === s.id && 'bg-brand-50')}>
                    <Icon className={clsx('mt-0.5 h-4 w-4 shrink-0', s.progress.status === 'PASSED' ? 'text-emerald-600' : s.progress.status === 'FAILED' ? 'text-red-500' : 'text-ink-300')} aria-label={s.progress.status} />
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5 text-sm font-semibold">
                        {s.id}
                        {s.applicability.status === 'REQUIRED' && <Badge tone="violet">Required</Badge>}
                        {s.applicability.status === 'CONDITIONAL_NOT_MET' && <Badge tone="amber">Retailer only</Badge>}
                      </span>
                      <span className="block truncate text-xs text-ink-500">{s.description}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>
        {selected ? <Workspace key={selected} scenario={L.scenarios.find((s) => s.id === selected)!} onChanged={() => qc.invalidateQueries({ queryKey: ['scenario-list'] })} /> : <Spinner />}
      </div>
    </div>
  );
}

function Workspace({ scenario, onChanged }: { scenario: ScenarioRow; onChanged: () => void }) {
  const toast = useToast();
  const lookups = useQuery({ queryKey: ['lookups'], queryFn: () => api<Lookups>('/api/app/lookups') });
  const tpl = useQuery({ queryKey: ['template', scenario.id], queryFn: () => api<TemplateResp>(`/api/app/sandbox/scenarios/${scenario.id}/template`) });
  const attempts = useQuery({ queryKey: ['scenario-attempts', scenario.id], queryFn: () => api<AttemptRow[]>(`/api/app/sandbox/scenarios/${scenario.id}/attempts`) });
  const [obj, setObj] = useState<Json | null>(null);
  const [jsonText, setJsonText] = useState('');
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [tab, setTab] = useState('form');
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [savedJson, setSavedJson] = useState<string | null>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [preview, setPreview] = useState<string | null>(null);
  const [result, setResult] = useState<{ op: 'VALIDATE' | 'POST'; r: FbrActionResult } | null>(null);

  const load = (t: TemplateResp, fromInvoice: boolean) => {
    let o = t.prepared;
    if (fromInvoice && t.latestInvoice && t.latestInvoice.status !== 'ACCEPTED') o = invoiceToJson(t.latestInvoice, t.prepared);
    setObj(o);
    setJsonText(JSON.stringify(o, null, 2));
    setJsonError(null);
    setInvoice(t.latestInvoice && t.latestInvoice.status !== 'ACCEPTED' ? t.latestInvoice : null);
    setSavedJson(fromInvoice && t.latestInvoice && t.latestInvoice.status !== 'ACCEPTED' ? JSON.stringify(o) : null);
    setIssues([]);
    setPreview(null);
  };
  useEffect(() => {
    if (tpl.data && !obj) load(tpl.data, true);
  }, [tpl.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = (o: Json) => {
    setObj(o);
    setJsonText(JSON.stringify(o, null, 2));
    setJsonError(null);
  };
  const dirty = obj ? JSON.stringify(obj) !== savedJson : false;
  const today = lookups.data?.today;
  const dateErr = obj && today ? (/^\d{4}-\d{2}-\d{2}$/.test(obj.invoiceDate ?? '') && Number(obj.invoiceDate.slice(0, 4)) === today.year && Number(obj.invoiceDate.slice(5, 7)) === today.month ? null : MONTH_RULE_MESSAGE) : null;

  const save = async (): Promise<Invoice> => {
    const r = await api<{ invoice: Invoice; issues: Issue[] }>('/api/app/sandbox/run', { body: { scenarioId: scenario.id, payload: obj, invoiceId: invoice?.id ?? null } });
    setInvoice(r.invoice);
    setSavedJson(JSON.stringify(obj));
    setIssues(r.issues);
    return r.invoice;
  };
  const run = useMutation({
    mutationFn: async (mode: 'validate' | 'submit' | 'both') => {
      setResult(null);
      let inv = invoice;
      if (!inv || dirty || inv.status === 'ACCEPTED') inv = await save();
      if (mode === 'validate' || mode === 'both' || !inv.validated) {
        const v = await api<FbrActionResult>(`/api/app/invoices/${inv.id}/validate`, { body: {} });
        setResult({ op: 'VALIDATE', r: v });
        setInvoice(v.invoice);
        if (mode === 'validate' || v.outcome !== 'VALID') return v;
        inv = v.invoice;
      }
      const s = await api<FbrActionResult>(`/api/app/invoices/${inv.id}/submit`, { body: {} });
      setResult({ op: 'POST', r: s });
      setInvoice(s.invoice);
      return s;
    },
    onSuccess: (r) => {
      toast(r.outcome === 'VALID' ? 'green' : 'amber', r.invoice.status === 'ACCEPTED' ? `Scenario ${scenario.id} accepted by FBR sandbox: ${r.invoice.fbrInvoiceNumber}` : `FBR outcome: ${r.outcome}`);
      attempts.refetch();
      onChanged();
    },
    onError: (e) => {
      if (e instanceof ApiError) setIssues(e.issues);
      attempts.refetch();
    },
  });
  const check = useMutation({
    mutationFn: () => api<{ issues: Issue[]; canonical: string | null }>('/api/app/sandbox/preview', { body: { scenarioId: scenario.id, payload: obj } }),
    onSuccess: (r) => {
      setIssues(r.issues);
      setPreview(r.canonical);
    },
  });

  if (tpl.isLoading || !obj) return <Spinner />;
  if (!tpl.data) return <ErrorBanner error={tpl.error} />;
  const T = tpl.data;
  const headerErr = (k: string) => issues.find((i) => i.field === k && !i.line && i.level === 'error')?.message;
  const itemErr = (line: number, k: string) => issues.find((i) => i.field === k && i.line === line && i.level === 'error')?.message;

  return (
    <div className="min-w-0 space-y-4">
      <Card
        title={<div><h2 className="text-base font-semibold">{scenario.id} — {scenario.description}</h2><p className="text-xs text-ink-500">Sale type (spec table): {scenario.saleTypeLabel} · Sent as: <code>{scenario.saleTypeApi}</code>{scenario.purchaseType && ' · Purchase-type scenario (cotton ginners)'}</p></div>}
        actions={<>{scenario.progress.status === 'PASSED' ? <Badge tone="green">Passed {dateTime(scenario.progress.passedAt)}</Badge> : <Badge tone={scenario.progress.status === 'FAILED' ? 'red' : 'gray'}>{scenario.progress.status.replace('_', ' ')}</Badge>}<Badge tone="gray">{scenario.progress.attempts} attempts</Badge></>}
      >
        <div className="space-y-2 text-sm">
          {scenario.applicability.reasons.length > 0 ? (
            <details><summary className="cursor-pointer text-xs font-medium text-ink-600">Why this scenario {scenario.applicability.status === 'REQUIRED' ? 'applies' : 'is listed'} ({scenario.applicability.reasons.length})</summary><ul className="mt-1 list-disc pl-5 text-xs text-ink-600">{scenario.applicability.reasons.map((r) => <li key={r}>{r}</li>)}</ul></details>
          ) : (
            <p className="text-xs text-ink-500">Not applicable to your business nature/sector per the matrix — you can still run it.</p>
          )}
          {scenario.progress.passedFbrNumber && <p className="text-xs">Sandbox FBR invoice number: <code className="font-semibold">{scenario.progress.passedFbrNumber}</code></p>}
          {T.original.anomalies.length > 0 && <Alert tone="amber" title="Notes on the supplied example">{T.original.anomalies.map((a) => <div key={a}>• {a}</div>)}</Alert>}
          {T.warnings.map((w) => <Alert key={w} tone="amber">{w}</Alert>)}
          {T.changes.length > 0 && (
            <details>
              <summary className="cursor-pointer text-xs font-medium text-ink-600">Changes applied to the supplied example ({T.changes.length})</summary>
              <ul className="mt-1 space-y-0.5 text-xs text-ink-600">{T.changes.map((c) => <li key={c.field}><code>{c.field}</code>: {JSON.stringify(c.from)} → {JSON.stringify(c.to)} — {c.reason}</li>)}</ul>
            </details>
          )}
          <details>
            <summary className="cursor-pointer text-xs font-medium text-ink-600">Original example as supplied ({T.label} in {T.source})</summary>
            <pre className="mt-1 max-h-64 overflow-auto rounded bg-ink-900 p-2 text-[11px] text-ink-100">{T.original.raw}</pre>
          </details>
        </div>
      </Card>

      <Card
        title="Request"
        actions={
          <Button size="sm" variant="ghost" onClick={() => load(T, false)}>
            <RotateCcw className="h-3.5 w-3.5" /> Reset to template
          </Button>
        }
      >
        <Tabs tabs={[{ id: 'form', label: 'Form' }, { id: 'json', label: 'JSON' }]} active={tab} onChange={setTab} />
        <div className="mt-3">
          {tab === 'form' ? (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {HEADER_FIELDS.map((f) => (
                  <label key={f.k} className="block text-xs">
                    <span className="block truncate font-mono text-ink-600" title={f.label}>{f.label}{f.note && ` (${f.note})`}</span>
                    {f.k === 'buyerRegistrationType' ? (
                      <select className={clsx('input mt-1', headerErr(f.k) && 'input-error')} value={obj[f.k] ?? ''} onChange={(e) => update({ ...obj, [f.k]: e.target.value })}>
                        <option value="">— select —</option><option>Registered</option><option>Unregistered</option>
                      </select>
                    ) : f.k === 'invoiceType' ? (
                      <select className="input mt-1" value={obj[f.k] ?? ''} onChange={(e) => update({ ...obj, [f.k]: e.target.value })}><option>Sale Invoice</option><option>Debit Note</option></select>
                    ) : f.k === 'invoiceDate' ? (
                      <input type="date" className={clsx('input mt-1', dateErr && 'input-error')} min={today?.monthStart} max={today?.monthEnd} value={obj[f.k] ?? ''} onChange={(e) => update({ ...obj, invoiceDate: e.target.value })} />
                    ) : (
                      <input className={clsx('input mt-1', headerErr(f.k) && 'input-error')} readOnly={f.readOnly} value={obj[f.k] ?? ''} onChange={(e) => update({ ...obj, [f.k]: e.target.value })} />
                    )}
                    {(f.k === 'invoiceDate' ? dateErr : headerErr(f.k)) && <span className="mt-0.5 block text-red-600">{f.k === 'invoiceDate' ? dateErr : headerErr(f.k)}</span>}
                  </label>
                ))}
              </div>
              {(obj.items as Json[]).map((it, i) => (
                <fieldset key={i} className="rounded-lg border border-ink-200 p-3">
                  <legend className="px-1 text-xs font-semibold text-ink-600">items[{i}]</legend>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                    {ITEM_FIELDS.map((k) => (
                      <label key={k} className="block text-xs">
                        <span className="block truncate font-mono text-[11px] text-ink-600" title={k}>{k}</span>
                        <input
                          className={clsx('input mt-1 py-1.5', NUMERIC.has(k) && 'tabular-nums', itemErr(i + 1, k === 'uoM' ? 'uom' : k) && 'input-error')}
                          inputMode={NUMERIC.has(k) ? 'decimal' : undefined}
                          value={it[k] === undefined || it[k] === null ? '' : String(it[k])}
                          onChange={(e) => {
                            const raw = e.target.value;
                            const val = NUMERIC.has(k) ? (raw === '' ? (k === 'extraTax' ? '' : 0) : /^-?\d*\.?\d*$/.test(raw) && raw !== '-' && !raw.endsWith('.') ? Number(raw) : raw) : raw;
                            const items = [...obj.items];
                            items[i] = { ...it, [k]: val };
                            update({ ...obj, items });
                          }}
                        />
                      </label>
                    ))}
                  </div>
                  <p className="mt-1 text-[11px] text-ink-500">Values are sent exactly as entered (scenario examples are not recalculated). Leave extraTax empty only if FBR asks for it (error 0091).</p>
                </fieldset>
              ))}
            </div>
          ) : (
            <div>
              <textarea
                aria-label="Request JSON"
                className={clsx('input h-[480px] font-mono text-[12px]', jsonError && 'input-error')}
                spellCheck={false}
                value={jsonText}
                onChange={(e) => {
                  setJsonText(e.target.value);
                  try {
                    const o = JSON.parse(e.target.value);
                    if (!o || typeof o !== 'object' || Array.isArray(o) || !Array.isArray(o.items)) throw new Error('The request must be an object with an "items" array');
                    setObj(o);
                    setJsonError(null);
                  } catch (err) {
                    setJsonError((err as Error).message);
                  }
                }}
              />
              {jsonError ? <p className="mt-1 text-xs text-red-600" role="alert">JSON syntax error: {jsonError}</p> : <p className="mt-1 text-xs text-emerald-700">Valid JSON — the form is in sync.</p>}
            </div>
          )}
        </div>
        {issues.length > 0 && (
          <ul className="mt-3 space-y-0.5 text-xs">
            {issues.map((i, k) => <li key={k} className={i.level === 'error' ? 'text-red-700' : 'text-amber-700'}>{i.level === 'error' ? '✕' : '⚠'} {i.line ? `items[${i.line - 1}] ` : ''}{i.field}: {i.message}</li>)}
          </ul>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => check.mutate()} loading={check.isPending} disabled={!!jsonError}>Check schema & preview request</Button>
          <Button variant="secondary" onClick={() => run.mutate('validate')} loading={run.isPending && run.variables === 'validate'} disabled={!!jsonError || !!dateErr || run.isPending}>Validate with FBR sandbox</Button>
          <Button onClick={() => run.mutate('both')} loading={run.isPending && run.variables === 'both'} disabled={!!jsonError || !!dateErr || run.isPending}>Validate & submit to sandbox</Button>
          {invoice && <Link to={`/app/invoices/${invoice.id}`} className="self-center text-xs text-brand-700 hover:underline">Open {invoice.internalNumber} ({invoice.status})</Link>}
        </div>
        {run.error && <div className="mt-3"><ErrorBanner error={run.error} /></div>}
        {preview && (
          <div className="mt-3">
            <p className="mb-1 text-xs font-medium text-ink-600">Exact request body (POST {'{sandbox URL}'} with Authorization: Bearer ••••)</p>
            <pre className="max-h-80 overflow-auto rounded-lg bg-ink-900 p-3 text-[11px] text-ink-100">{preview}</pre>
          </div>
        )}
      </Card>

      {result && (
        <Card title="FBR sandbox response">
          <FbrResult op={result.op} outcome={result.r.outcome} httpStatus={result.r.httpStatus} issues={result.r.issues} raw={result.r.rawResponse} />
          {result.r.invoice.status === 'ACCEPTED' && <Alert tone="green" className="mt-3" title={`FBR invoice number ${result.r.invoice.fbrInvoiceNumber}`}>This scenario is now recorded as passed in InvoiceGO. Check the scenario status in IRIS as well — InvoiceGO cannot change IRIS itself.</Alert>}
        </Card>
      )}

      <Card title="Attempt history" bodyClass="p-0">
        {!attempts.data?.length ? (
          <p className="p-4 text-sm text-ink-500">No attempts yet for {scenario.id}.</p>
        ) : (
          <ul className="divide-y divide-ink-100">
            {attempts.data.map((a) => (
              <li key={a.id} className="p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="gray">{a.operation}</Badge>
                  <OutcomeBadge outcome={a.outcome} />
                  <span className="text-xs text-ink-500">HTTP {a.httpStatus ?? '—'} · {dateTime(a.startedAt)} · {a.internalNumber}</span>
                  {a.fbrInvoiceNo && <Badge tone="green">{a.fbrInvoiceNo}</Badge>}
                </div>
                {a.issues.length > 0 && <p className="mt-1 text-xs text-red-700">{a.issues.map((x) => `${x.code ? `[${x.code}] ` : ''}${x.message}`).join(' · ')}</p>}
                {a.responseBody && <details className="mt-1"><summary className="cursor-pointer text-xs text-brand-700">Raw response</summary><pre className="mt-1 max-h-60 overflow-auto rounded bg-ink-900 p-2 text-[11px] text-emerald-100">{prettify(a.responseBody)}</pre></details>}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <p className="text-xs text-ink-500">Production tokens are issued by IRIS after the required scenarios pass (Production Environment → View Security Token). InvoiceGO never generates or fetches production credentials.</p>
    </div>
  );
}

/** Rebuild contract JSON from a saved sandbox invoice so edits continue where the user left off. */
function invoiceToJson(inv: Invoice, prepared: Json): Json {
  const num = (v: string | null) => (v === null ? 0 : Number(v));
  return {
    ...prepared,
    invoiceType: inv.invoiceType === 'DEBIT_NOTE' ? 'Debit Note' : 'Sale Invoice',
    invoiceDate: inv.invoiceDate,
    buyerNTNCNIC: inv.buyerNtnCnic,
    buyerBusinessName: inv.buyerBusinessName,
    buyerProvince: inv.buyerProvince,
    buyerAddress: inv.buyerAddress,
    buyerRegistrationType: inv.buyerRegistrationType === 'REGISTERED' ? 'Registered' : inv.buyerRegistrationType === 'UNREGISTERED' ? 'Unregistered' : '',
    invoiceRefNo: inv.invoiceRefNo,
    items: inv.items.map((it) => ({
      hsCode: it.hsCode,
      productDescription: it.productDescription,
      rate: it.rate,
      uoM: it.uom,
      quantity: num(it.quantity),
      totalValues: num(it.totalValues),
      valueSalesExcludingST: num(it.valueSalesExcludingST),
      fixedNotifiedValueOrRetailPrice: num(it.fixedNotifiedValueOrRetailPrice),
      salesTaxApplicable: num(it.salesTaxApplicable),
      salesTaxWithheldAtSource: num(it.salesTaxWithheldAtSource),
      extraTax: it.extraTaxEmpty ? '' : num(it.extraTax),
      furtherTax: num(it.furtherTax),
      sroScheduleNo: it.sroScheduleNo,
      fedPayable: num(it.fedPayable),
      discount: num(it.discount),
      saleType: it.saleType,
      sroItemSerialNo: it.sroItemSerialNo,
    })),
  };
}

