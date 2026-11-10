import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileCheck2, Plus, Save, Send, ShieldCheck, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import { api, ApiError, qs, type Issue } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { pkr } from '@/lib/format';
import { emptyItem, MONTH_RULE_MESSAGE, type BuyerCheck, type Customer, type Invoice, type InvoiceItem, type Lookups, type Product } from '@/lib/types';
import { Alert, Badge, Button, Card, Checkbox, ConfirmDialog, EnvBadge, ErrorBanner, Field, PageHeader, SelectInput, Spinner, TextInput, issueFor, useToast } from '@/components/ui';
import { Combobox } from '@/components/Combobox';
import { useHsSearch, useLineOptions } from '@/lib/fbrOptions';
import { useDebounced } from '@/lib/useDebounced';

interface CalcLine {
  line: number;
  values: { grossValue: string; valueSalesExcludingST: string; fixedNotifiedValueOrRetailPrice: string; salesTaxApplicable: string; totalValues: string; rateKind: string } | null;
  issues: { field: string; level: 'error' | 'warning'; message: string }[];
}


export default function InvoiceBuilder() {
  const { id } = useParams();
  const editing = !!id;
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const { me, can } = useAuth();
  const lookups = useQuery({ queryKey: ['lookups'], queryFn: () => api<Lookups>('/api/app/lookups') });
  const business = useQuery({ queryKey: ['business'], queryFn: () => api<{ furtherTaxHelperRate: string | null; productionEnabled: boolean; name: string; ntnCnic: string; province: string; address: string }>('/api/app/business') });
  const scenarios = useQuery({ queryKey: ['scenario-list'], queryFn: () => api<{ scenarios: { id: string; description: string; applicability: { status: string } }[] }>('/api/app/sandbox/scenarios') });
  const existing = useQuery({ queryKey: ['invoice', id], queryFn: () => api<Invoice>(`/api/app/invoices/${id}`), enabled: editing });

  // New invoices are production invoices; sandbox testing has its own section (Sandbox scenarios).
  const [env, setEnv] = useState<'SANDBOX' | 'PRODUCTION'>('PRODUCTION');
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [h, setH] = useState({ invoiceType: 'SALE_INVOICE', invoiceDate: '', invoiceTime: '', paymentMode: 'Cash', invoiceRefNo: '', scenarioId: '', customerId: '' as string | null, buyerNtnCnic: '', buyerBusinessName: '', buyerProvince: '', buyerAddress: '', buyerRegistrationType: '' as '' | 'REGISTERED' | 'UNREGISTERED', notes: '' });
  const [items, setItems] = useState<InvoiceItem[]>([emptyItem()]);
  const [autoCalc, setAutoCalc] = useState(true);
  const [serverIssues, setServerIssues] = useState<Issue[]>([]);
  const [dateError, setDateError] = useState<string | null>(null);
  const [buyerCheck, setBuyerCheck] = useState<BuyerCheck | null>(null);
  const [version, setVersion] = useState<number | undefined>();
  const loaded = useRef(false);

  // initialise
  useEffect(() => {
    if (!lookups.data || loaded.current) return;
    if (editing && !existing.data) return;
    loaded.current = true;
    if (editing && existing.data) {
      const x = existing.data;
      setEnv(x.environment);
      setH({ invoiceType: x.invoiceType, invoiceDate: x.invoiceDate, invoiceTime: x.invoiceTime, paymentMode: x.paymentMode ?? '', invoiceRefNo: x.invoiceRefNo, scenarioId: x.scenarioId ?? '', customerId: x.customerId, buyerNtnCnic: x.buyerNtnCnic, buyerBusinessName: x.buyerBusinessName, buyerProvince: x.buyerProvince, buyerAddress: x.buyerAddress, buyerRegistrationType: x.buyerRegistrationType ?? '', notes: x.notes ?? '' });
      setItems(x.items.map((it) => ({ ...it, retailPricePerUnit: it.retailPricePerUnit ?? '' })));
      setAutoCalc(x.autoCalc);
      setVersion(x.version);
      const m = checkMonth(x.invoiceDate, lookups.data.today);
      setDateError(m);
    } else {
      setH((p) => ({ ...p, invoiceDate: lookups.data.today.date, invoiceTime: lookups.data.today.time, buyerProvince: lookups.data.provinces.values[0] ?? '' }));
    }
  }, [lookups.data, existing.data, editing]);


  // server-side calculation preview (single source of truth for maths)
  const debouncedItems = useDebounced(items);
  const calc = useQuery({
    queryKey: ['calc', autoCalc, debouncedItems],
    queryFn: () => api<{ lines: CalcLine[]; totals: Record<string, string> }>('/api/app/invoices/calc', { body: { autoCalc, items: debouncedItems.map(cleanItem) } }),
    placeholderData: (p) => p,
  });

  const [custQ, setCustQ] = useState('');
  const customers = useQuery({ queryKey: ['cust-search', custQ], queryFn: () => api<{ rows: Customer[] }>(`/api/app/customers${qs({ q: custQ, pageSize: 20 })}`) });
  const products = useQuery({ queryKey: ['prod-all'], queryFn: () => api<{ rows: Product[] }>(`/api/app/products${qs({ pageSize: 100 })}`) });

  const today = lookups.data?.today;
  const editable = !editing || ['DRAFT', 'VALIDATED', 'VALIDATION_FAILED', 'REJECTED'].includes(existing.data?.status ?? 'DRAFT');

  const save = useMutation({
    mutationFn: async (then: 'stay' | 'validate' | 'submit') => {
      const body = { ...h, environment: env, autoCalc, version, scenarioId: env === 'SANDBOX' ? h.scenarioId || null : null, customerId: h.customerId || null, buyerRegistrationType: h.buyerRegistrationType || null, paymentMode: h.paymentMode || null, items: items.map(cleanItem) };
      const r = editing ? await api<{ invoice: Invoice; issues: Issue[] }>(`/api/app/invoices/${id}`, { method: 'PUT', body }) : await api<{ invoice: Invoice; issues: Issue[] }>('/api/app/invoices', { body });
      return { r, then };
    },
    onSuccess: async ({ r, then }) => {
      setServerIssues(r.issues);
      await qc.invalidateQueries({ queryKey: ['invoices'] });
      qc.setQueryData(['invoice', r.invoice.id], r.invoice);
      toast('green', `Saved ${r.invoice.internalNumber}`);
      nav(`/app/invoices/${r.invoice.id}${then === 'stay' ? '' : `?action=${then}`}`);
    },
    onError: (e) => {
      if (e instanceof ApiError) {
        setServerIssues(e.issues);
        if (e.code === 'MONTH_RULE') setDateError(MONTH_RULE_MESSAGE);
      }
    },
  });

  const verifyBuyer = useMutation({
    mutationFn: () => api<BuyerCheck>('/api/app/invoices/buyer-check', { body: { buyerNtnCnic: h.buyerNtnCnic, buyerBusinessName: h.buyerBusinessName, buyerRegistrationType: h.buyerRegistrationType || null, invoiceDate: h.invoiceDate || null } }),
    onSuccess: setBuyerCheck,
  });

  const issues = useMemo(() => [...serverIssues], [serverIssues]);
  if (lookups.isLoading || (editing && existing.isLoading)) return <Spinner />;
  if (!lookups.data) return <ErrorBanner error={lookups.error} />;
  const L = lookups.data;

  const setItem = (i: number, patch: Partial<InvoiceItem>) => setItems((xs) => xs.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  const onDate = (v: string) => {
    setH({ ...h, invoiceDate: v });
    setDateError(checkMonth(v, L.today));
  };
  const pickCustomer = (cid: string) => {
    const c = customers.data?.rows.find((x) => x.id === cid);
    if (!c) {
      setH({ ...h, customerId: null });
      return;
    }
    setBuyerCheck(null);
    setH({ ...h, customerId: c.id, buyerNtnCnic: c.ntnCnic ?? '', buyerBusinessName: c.name, buyerProvince: c.province, buyerAddress: c.address, buyerRegistrationType: c.registrationType });
  };
  const pickProduct = (i: number, pid: string) => {
    const p = products.data?.rows.find((x) => x.id === pid);
    if (!p) return setItem(i, { productId: null });
    setItem(i, { productId: p.id, saleType: p.saleType, hsCode: p.hsCode, productDescription: p.description, uom: p.uom, rate: p.rate ?? items[i].rate, unitPrice: p.unitPrice, retailPricePerUnit: p.retailPrice ?? '', sroScheduleNo: p.sroScheduleNo ?? '', sroItemSerialNo: p.sroItemSerialNo ?? '' });
  };
  const helperRate = business.data?.furtherTaxHelperRate;
  const fbrReady = env === 'SANDBOX' || !!business.data?.productionEnabled;
  const regMismatch = buyerCheck?.mismatch ? buyerCheck.message : null;

  return (
    <div className="space-y-5 pb-24">
      <PageHeader
        title={editing ? `Edit ${existing.data?.internalNumber}` : 'Create invoice'}
        subtitle={<>Seller details come from your business profile. Fields marked <span className="text-red-600">*</span> are required.</>}
        actions={<EnvBadge env={env} />}
      />
      {!editable && (
        <Alert tone="amber" title="This invoice can no longer be edited">
          Status: {existing.data?.status}. <Link className="underline" to={`/app/invoices/${id}`}>Open the invoice</Link>.
        </Alert>
      )}
      {env === 'PRODUCTION' && business.data && !business.data.productionEnabled && (
        <Alert tone="amber" title="Production is not enabled yet">
          You can prepare and save drafts now. To validate and submit them to FBR, pass the required tests in <Link className="font-medium underline" to="/app/sandbox">Sandbox scenarios</Link>, then save the production token and enable production in <Link className="font-medium underline" to="/app/fbr">FBR integration</Link>.
        </Alert>
      )}
      {save.error && <ErrorBanner error={save.error} />}

      <Card title="Invoice details">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <SelectInput label="Type" required value={h.invoiceType} onChange={(e) => setH({ ...h, invoiceType: e.target.value })} options={L.invoiceTypes} />
          <Field label="Date" required error={dateError ?? issueFor(issues, 'invoiceDate')} hint={`Current month only (${today?.monthStart} to ${today?.monthEnd}, PKT)`}>
            <input type="date" className={clsx('input', (dateError || issueFor(issues, 'invoiceDate')) && 'input-error')} value={h.invoiceDate} min={today?.monthStart} max={today?.monthEnd} onChange={(e) => onDate(e.target.value)} aria-invalid={!!dateError} required />
          </Field>
          <TextInput label="Current time" type="time" value={h.invoiceTime} onChange={(e) => setH({ ...h, invoiceTime: e.target.value })} hint="Shown on the invoice; not sent to FBR" />
          <Combobox label="Payment mode" value={h.paymentMode} onChange={(val) => setH({ ...h, paymentMode: val })} options={L.paymentModes.map((p) => ({ value: p }))} hint="How the buyer pays; not sent to FBR" />
          <TextInput label="Reference invoice no." required={h.invoiceType === 'DEBIT_NOTE'} value={h.invoiceRefNo} onChange={(e) => setH({ ...h, invoiceRefNo: e.target.value.trim() })} error={issueFor(issues, 'invoiceRefNo')} hint={h.invoiceType === 'DEBIT_NOTE' ? 'Original FBR invoice number (22 or 28 characters)' : 'Only for debit notes'} />
          {env === 'SANDBOX' && (
            <SelectInput label="Sandbox scenario" required value={h.scenarioId} onChange={(e) => setH({ ...h, scenarioId: e.target.value })} placeholder="Select scenario…" options={(scenarios.data?.scenarios ?? []).map((s) => ({ value: s.id, label: `${s.id} — ${s.description}${s.applicability.status === 'REQUIRED' ? ' (required)' : ''}` }))} error={issueFor(issues, 'scenarioId')} className="sm:col-span-2" />
          )}
        </div>
      </Card>

      <Card title="Seller details (from business profile)" actions={<Link to="/app/settings" className="text-xs text-brand-700 hover:underline">Edit profile</Link>}>
        <dl className="grid gap-3 text-sm sm:grid-cols-4">
          <div><dt className="text-xs text-ink-500">Seller NTN/CNIC</dt><dd className="font-medium">{business.data?.ntnCnic}</dd></div>
          <div><dt className="text-xs text-ink-500">Business name</dt><dd className="font-medium">{business.data?.name}</dd></div>
          <div><dt className="text-xs text-ink-500">Province</dt><dd className="font-medium">{business.data?.province}</dd></div>
          <div><dt className="text-xs text-ink-500">Address</dt><dd className="font-medium">{business.data?.address}</dd></div>
        </dl>
      </Card>

      <Card title="Buyer details">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Saved customer" hint="Search and select, or type a new buyer below">
            <div className="flex gap-2">
              <input className="input" placeholder="Search customers…" value={custQ} onChange={(e) => setCustQ(e.target.value)} aria-label="Search customers" />
              <select className="input" value={h.customerId ?? ''} onChange={(e) => pickCustomer(e.target.value)} aria-label="Select customer">
                <option value="">New buyer</option>
                {customers.data?.rows.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} {c.ntnCnic ? `(${c.ntnCnic})` : ''}
                  </option>
                ))}
              </select>
            </div>
          </Field>
          <TextInput label="Buyer NTN / CNIC" required={h.buyerRegistrationType === 'REGISTERED'} inputMode="numeric" value={h.buyerNtnCnic} onChange={(e) => { setBuyerCheck(null); setH({ ...h, buyerNtnCnic: e.target.value.trim() }); }} error={issueFor(issues, 'buyerNtnCnic')} hint="7-digit NTN or 13-digit CNIC; optional for unregistered buyers" />
          <TextInput label="Buyer name" required value={h.buyerBusinessName} onChange={(e) => setH({ ...h, buyerBusinessName: e.target.value })} error={issueFor(issues, 'buyerBusinessName')} />
          <Combobox label="Buyer province" required value={h.buyerProvince} onChange={(val) => setH({ ...h, buyerProvince: val })} options={L.provinces.values.map((p) => ({ value: p }))} allowCustom={false} source={L.provinces.source.startsWith('FBR') ? 'Official list from FBR' : 'Provinces'} error={issueFor(issues, 'buyerProvince')} placeholder="Choose the province" />
          <TextInput label="Buyer address" required value={h.buyerAddress} onChange={(e) => setH({ ...h, buyerAddress: e.target.value })} error={issueFor(issues, 'buyerAddress')} />
          <Field label="Buyer type" required error={regMismatch ?? issueFor(issues, 'buyerRegistrationType')}>
            <div className={clsx('flex gap-2 rounded-lg', regMismatch && 'ring-2 ring-red-400')} role="radiogroup" aria-label="Buyer type">
              {(['REGISTERED', 'UNREGISTERED'] as const).map((r) => (
                <label key={r} className={clsx('flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm', h.buyerRegistrationType === r ? 'border-brand-500 bg-brand-50 font-medium text-brand-800' : 'border-ink-200 bg-white')}>
                  <input type="radio" name="buyerType" className="sr-only" checked={h.buyerRegistrationType === r} onChange={() => { setBuyerCheck(null); setH({ ...h, buyerRegistrationType: r }); }} />
                  {r === 'REGISTERED' ? 'Registered' : 'Unregistered'}
                </label>
              ))}
            </div>
          </Field>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={() => verifyBuyer.mutate()} loading={verifyBuyer.isPending} disabled={!h.buyerNtnCnic}>
            <ShieldCheck className="h-3.5 w-3.5" /> Verify registration with FBR
          </Button>
          {buyerCheck && !buyerCheck.mismatch && buyerCheck.result !== 'UNAVAILABLE' && buyerCheck.result !== 'NOT_CHECKED' && <Badge tone="green">FBR: {buyerCheck.result === 'REGISTERED' ? 'Registered' : 'Unregistered'} — matches</Badge>}
          {buyerCheck?.result === 'UNAVAILABLE' && <Badge tone="amber">Verification unavailable — not treated as unregistered</Badge>}
          {verifyBuyer.error && <span className="text-xs text-red-600">{(verifyBuyer.error as Error).message}</span>}
        </div>
        {buyerCheck?.result === 'UNAVAILABLE' && <p className="mt-2 text-xs text-amber-700">{buyerCheck.message}</p>}
        {buyerCheck?.activeStatus && (
          <p className="mt-2 text-xs text-ink-600">
            {buyerCheck.activeStatus.available ? (
              <>FBR active-taxpayer status (STATL) on {buyerCheck.activeStatus.date}: <Badge tone={/^active$/i.test(buyerCheck.activeStatus.status ?? '') ? 'green' : 'amber'}>{buyerCheck.activeStatus.status ?? `code ${buyerCheck.activeStatus.statusCode}`}</Badge> <span className="text-ink-500">Shown as FBR reports it; it does not block the invoice.</span></>
            ) : (
              <span className="text-amber-700">{buyerCheck.activeStatus.message}</span>
            )}
          </p>
        )}
      </Card>

      <Card
        title="Items details"
        actions={
          <>
            <Checkbox label="Automatic calculation" checked={autoCalc} onChange={setAutoCalc} />
            <Button size="sm" variant="secondary" onClick={() => setItems([...items, emptyItem()])}>
              <Plus className="h-3.5 w-3.5" /> Add item
            </Button>
          </>
        }
      >
        {!autoCalc && <Alert tone="amber" className="mb-3">Manual mode: values are sent exactly as entered. Differences from the general formula are shown as warnings for review.</Alert>}
        <div className="space-y-4">
          {items.map((it, i) => (
            <ItemLine
              key={i}
              index={i}
              it={it}
              calc={calc.data?.lines[i]}
              issues={issues}
              autoCalc={autoCalc}
              L={L}
              products={products.data?.rows ?? []}
              onPickProduct={(pid) => pickProduct(i, pid)}
              onChange={(patch) => setItem(i, patch)}
              onRemove={items.length > 1 ? () => setItems(items.filter((_, k) => k !== i)) : undefined}
              helperRate={helperRate}
              buyerUnregistered={h.buyerRegistrationType === 'UNREGISTERED'}
              invoiceDate={h.invoiceDate}
              sellerProvince={business.data?.province ?? ''}
            />
          ))}
        </div>
      </Card>

      <Card title="Totals preview">
        <dl className="grid gap-3 text-sm sm:grid-cols-3 lg:grid-cols-5">
          {[
            ['Value excl. ST', calc.data?.totals.totalValueExclST],
            ['Sales tax', calc.data?.totals.totalSalesTax],
            ['Further tax', calc.data?.totals.totalFurtherTax],
            ['Extra tax + FED', calc.data ? String(Number(calc.data.totals.totalExtraTax) + Number(calc.data.totals.totalFed)) : undefined],
            ['ST withheld', calc.data?.totals.totalWithheld],
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="text-xs text-ink-500">{k}</dt>
              <dd className="font-medium tabular-nums">{pkr(v)}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-4 flex flex-wrap items-end justify-between gap-3 border-t border-ink-100 pt-3">
          <div>
            <p className="text-xs text-ink-500">Gross invoice value (incl. taxes)</p>
            <p className="text-2xl font-semibold tabular-nums text-ink-900">{pkr(calc.data?.totals.grandTotal)}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-ink-500">Net receivable (after ST withheld)</p>
            <p className="text-lg font-medium tabular-nums">{pkr(calc.data?.totals.netReceivable)}</p>
          </div>
        </div>
      </Card>

      <div className="no-print fixed inset-x-0 bottom-0 z-20 border-t border-ink-200 bg-white/95 px-4 py-3 backdrop-blur lg:left-[260px]">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-end gap-2">
          {dateError && <span className="mr-auto text-sm font-medium text-red-600" role="alert">{dateError}</span>}
          {regMismatch && <span className="mr-auto text-sm font-medium text-red-600" role="alert">{regMismatch}</span>}
          <Button variant="secondary" onClick={() => nav(-1)}>
            Cancel
          </Button>
          <Button variant="secondary" onClick={() => save.mutate('stay')} loading={save.isPending && save.variables === 'stay'} disabled={!editable || !!dateError || !me || save.isPending}>
            <Save className="h-4 w-4" /> Save as draft
          </Button>
          <Button variant="secondary" onClick={() => save.mutate('validate')} loading={save.isPending && save.variables === 'validate'} disabled={!editable || !!dateError || !!regMismatch || !fbrReady || save.isPending} title={fbrReady ? 'Save, then check the invoice with FBR without submitting it' : 'Enable production first'}>
            <FileCheck2 className="h-4 w-4" /> Validate
          </Button>
          <Button onClick={() => setConfirmSubmit(true)} loading={save.isPending && save.variables === 'submit'} disabled={!editable || !!dateError || !!regMismatch || !fbrReady || save.isPending || !can('submit')} title={fbrReady ? 'Save, validate with FBR and submit' : 'Enable production first'}>
            <Send className="h-4 w-4" /> Submit to FBR
          </Button>
        </div>
      </div>
      <ConfirmDialog
        open={confirmSubmit}
        onClose={() => setConfirmSubmit(false)}
        title={env === 'PRODUCTION' ? 'Submit this invoice to FBR?' : 'Submit to the FBR sandbox?'}
        confirmLabel={env === 'PRODUCTION' ? 'Save, validate and submit' : 'Submit to sandbox'}
        danger={env === 'PRODUCTION'}
        onConfirm={() => {
          setConfirmSubmit(false);
          save.mutate('submit');
        }}
        message={env === 'PRODUCTION' ? 'The invoice is saved, validated with FBR and — only if FBR reports it valid — submitted as a real tax invoice. Once FBR accepts it, it cannot be changed or submitted again.' : 'The invoice is saved, validated and submitted to the FBR sandbox (testing only).'}
      />
    </div>
  );
}

function NumOut({ label, auto, value, onChange, error }: { label: string; auto: boolean; value: string | null | undefined; onChange: (v: string) => void; error?: string | null }) {
  return (
    <Field label={label} error={error} hint={auto ? 'Calculated' : undefined}>
      <input className={clsx('input tabular-nums', auto && 'bg-ink-50', error && 'input-error')} inputMode="decimal" readOnly={auto} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

function checkMonth(v: string, today: Lookups['today']) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return 'Enter a valid date';
  const [y, m] = v.split('-').map(Number);
  return y === today.year && m === today.month ? null : MONTH_RULE_MESSAGE;
}

function cleanItem(it: InvoiceItem) {
  const n = (x: string | null | undefined) => (x === null || x === undefined || String(x).trim() === '' ? null : String(x).replace(/,/g, '').trim());
  return {
    productId: it.productId,
    saleType: it.saleType,
    hsCode: it.hsCode,
    productDescription: it.productDescription,
    rate: it.rate,
    uom: it.uom,
    quantity: n(it.quantity),
    unitPrice: n(it.unitPrice),
    discount: n(it.discount),
    valueSalesExcludingST: n(it.valueSalesExcludingST),
    salesTaxApplicable: n(it.salesTaxApplicable),
    retailPricePerUnit: n(it.retailPricePerUnit),
    fixedNotifiedValueOrRetailPrice: n(it.fixedNotifiedValueOrRetailPrice),
    extraTax: it.extraTaxEmpty ? null : n(it.extraTax),
    extraTaxEmpty: it.extraTaxEmpty,
    furtherTax: n(it.furtherTax),
    fedPayable: n(it.fedPayable),
    salesTaxWithheldAtSource: n(it.salesTaxWithheldAtSource),
    sroScheduleNo: it.sroScheduleNo,
    sroItemSerialNo: it.sroItemSerialNo,
    totalValues: n(it.totalValues),
  };
}

/** One invoice line. FBR dropdown lists are loaded per line (sale type → rate → SRO → item, HS → UOM). */
function ItemLine({ index, it, calc, issues, autoCalc, L, products, onPickProduct, onChange, onRemove, helperRate, buyerUnregistered, invoiceDate, sellerProvince }: {
  index: number;
  it: InvoiceItem;
  calc: CalcLine | undefined;
  issues: Issue[];
  autoCalc: boolean;
  L: Lookups;
  products: Product[];
  onPickProduct: (id: string) => void;
  onChange: (patch: Partial<InvoiceItem>) => void;
  onRemove?: () => void;
  helperRate: string | null | undefined;
  buyerUnregistered: boolean;
  invoiceDate: string;
  sellerProvince: string;
}) {
  const line = index + 1;
  const v = calc?.values;
  const lineIssues = [...(calc?.issues ?? []), ...issues.filter((x) => x.line === line)];
  const err = (f: string) => lineIssues.find((x) => x.field === f && x.level === 'error')?.message ?? null;
  const salesTaxEditable = !autoCalc || v?.rateKind === 'UNKNOWN';
  const o = useLineOptions({ saleType: it.saleType, hsCode: it.hsCode, uom: it.uom, rate: it.rate, sroScheduleNo: it.sroScheduleNo, invoiceDate, sellerProvince }, L);
  const hs = useHsSearch(it.hsCode);
  return (
    <fieldset className="animate-fade-up rounded-xl border border-ink-200 bg-white p-3 transition-shadow hover:shadow-md hover:shadow-ink-900/5">
      <legend className="flex items-center gap-2 px-1 text-xs font-semibold text-ink-600">
        Item {line}
        {it.fbr?.error && <Badge tone="red">FBR {it.fbr.errorCode}: {it.fbr.error}</Badge>}
      </legend>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <Combobox
          label="Saved product"
          className="lg:col-span-2"
          value={products.find((p) => p.id === it.productId) ? `${products.find((p) => p.id === it.productId)!.sku} · ${products.find((p) => p.id === it.productId)!.description}` : ''}
          options={products.map((p) => ({ value: `${p.sku} · ${p.description}`, description: `${p.hsCode} · ${p.saleType}` }))}
          onChange={(val, opt) => {
            if (!opt) return;
            const p = products.find((x) => `${x.sku} · ${x.description}` === opt.value);
            if (p) onPickProduct(p.id);
          }}
          allowCustom={false}
          placeholder="Choose a saved product (optional)"
          emptyText="No saved products yet — add them under Products"
        />
        <Combobox label="Sale type" required className="lg:col-span-2" value={it.saleType} options={o.saleTypes.options} source={o.saleTypes.source} onChange={(val, opt) => onChange(opt ? { saleType: val, rate: '', sroScheduleNo: '', sroItemSerialNo: '' } : { saleType: val })} error={err('saleType')} placeholder="Choose the sale type" />
        <Combobox label="HS code" required value={it.hsCode} options={hs.options} onQuery={hs.onQuery} loading={hs.loading} source="Search by code or description" onChange={(val, opt) => onChange({ hsCode: val.trim(), ...(opt?.description && !it.productDescription ? { productDescription: opt.description.slice(0, 200) } : {}) })} error={err('hsCode')} placeholder="0000.0000" />
        <Combobox label="Tax rate" required value={it.rate} options={o.rates.options} source={o.rates.source} loading={o.rates.loading} onChange={(val, opt) => onChange(opt ? { rate: val, sroScheduleNo: '', sroItemSerialNo: '' } : { rate: val })} error={err('rate')} hint={v?.rateKind === 'UNKNOWN' ? 'Not auto-calculable — enter the sales tax' : undefined} placeholder="e.g. 18%" />
        <TextInput label="Product description" required className="lg:col-span-3" value={it.productDescription} onChange={(e) => onChange({ productDescription: e.target.value })} error={err('productDescription')} />
        <Combobox label="UOM" required value={it.uom} options={o.uoms.options} source={o.uoms.source} loading={o.uoms.loading} onChange={(val) => onChange({ uom: val })} error={err('uom') ?? (o.uomMismatch ? `FBR expects ${o.uomMismatch.join(' or ')} for this HS code` : null)} placeholder="Unit of measure" />
        <TextInput label="Quantity" required inputMode="decimal" value={it.quantity ?? ''} onChange={(e) => onChange({ quantity: e.target.value })} error={err('quantity')} />
        <TextInput label="Unit price (excl. tax)" required={autoCalc} inputMode="decimal" value={it.unitPrice ?? ''} onChange={(e) => onChange({ unitPrice: e.target.value })} error={err('unitPrice')} />
        <TextInput label="Discount" inputMode="decimal" value={it.discount ?? ''} onChange={(e) => onChange({ discount: e.target.value })} error={err('discount')} hint="Amount; deducted once" />
        <NumOut label="Value of sales (excl. tax)" auto={autoCalc} value={autoCalc ? v?.valueSalesExcludingST : it.valueSalesExcludingST} onChange={(x) => onChange({ valueSalesExcludingST: x })} />
        <NumOut label="Sales tax" auto={!salesTaxEditable} value={salesTaxEditable ? it.salesTaxApplicable : v?.salesTaxApplicable} onChange={(x) => onChange({ salesTaxApplicable: x })} error={err('salesTaxApplicable')} />
        <TextInput label="Retail price / unit" inputMode="decimal" value={it.retailPricePerUnit ?? ''} onChange={(e) => onChange({ retailPricePerUnit: e.target.value })} hint="Third Schedule goods" />
        <NumOut label="Fixed / notified value or retail price" auto={autoCalc && !!it.retailPricePerUnit} value={autoCalc && it.retailPricePerUnit ? v?.fixedNotifiedValueOrRetailPrice : it.fixedNotifiedValueOrRetailPrice} onChange={(x) => onChange({ fixedNotifiedValueOrRetailPrice: x })} error={err('fixedNotifiedValueOrRetailPrice')} />
        <Field label="Extra tax">
          <input className="input" inputMode="decimal" disabled={it.extraTaxEmpty} value={it.extraTaxEmpty ? '' : it.extraTax ?? ''} onChange={(e) => onChange({ extraTax: e.target.value })} />
          <label className="mt-1 flex items-center gap-1 text-[11px] text-ink-500">
            <input type="checkbox" checked={it.extraTaxEmpty} onChange={(e) => onChange({ extraTaxEmpty: e.target.checked, extraTax: '' })} /> Send as empty (FBR 0091)
          </label>
        </Field>
        <Field label="Further tax">
          <input className="input" inputMode="decimal" value={it.furtherTax ?? ''} onChange={(e) => onChange({ furtherTax: e.target.value })} />
          {helperRate && buyerUnregistered && v && (
            <button type="button" className="mt-1 text-[11px] text-brand-700 hover:underline" onClick={() => onChange({ furtherTax: (Math.round(Number(v.valueSalesExcludingST) * Number(helperRate)) / 100).toFixed(2) })}>
              Apply {helperRate}% (your helper rate)
            </button>
          )}
        </Field>
        <TextInput label="FED payable" inputMode="decimal" value={it.fedPayable ?? ''} onChange={(e) => onChange({ fedPayable: e.target.value })} />
        <TextInput label="ST withheld at source" inputMode="decimal" value={it.salesTaxWithheldAtSource ?? ''} onChange={(e) => onChange({ salesTaxWithheldAtSource: e.target.value })} hint="0 or equal to sales tax" />
        <Combobox label="SRO / schedule no." value={it.sroScheduleNo} options={o.sros.options} source={o.sros.source} loading={o.sros.loading} onChange={(val, opt) => onChange(opt ? { sroScheduleNo: val, sroItemSerialNo: '' } : { sroScheduleNo: val })} error={err('sroScheduleNo')} placeholder="If an SRO applies" />
        <Combobox label="Item S. No." value={it.sroItemSerialNo} options={o.sroItems.options} source={o.sroItems.source} loading={o.sroItems.loading} onChange={(val) => onChange({ sroItemSerialNo: val })} error={err('sroItemSerialNo')} placeholder="SRO item serial" />
        <NumOut label="Total (incl. taxes)" auto={autoCalc} value={autoCalc ? v?.totalValues : it.totalValues} onChange={(x) => onChange({ totalValues: x })} />
      </div>
      {o.fbrOff && index === 0 && (
        <p className="mt-2 text-xs text-ink-500">Lists show common values. <Link to="/app/fbr" className="text-brand-700 hover:underline">Add your FBR token</Link> to get FBR’s official sale types, rates, SROs and UOMs.</p>
      )}
      {lineIssues.filter((x) => x.level === 'warning').length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs text-amber-700">
          {lineIssues.filter((x) => x.level === 'warning').map((x, k) => <li key={k}>⚠ {x.message}</li>)}
        </ul>
      )}
      {onRemove && (
        <div className="mt-2 text-right">
          <Button size="sm" variant="ghost" onClick={onRemove} aria-label={`Remove item ${line}`}>
            <Trash2 className="h-3.5 w-3.5" /> Remove
          </Button>
        </div>
      )}
    </fieldset>
  );
}
