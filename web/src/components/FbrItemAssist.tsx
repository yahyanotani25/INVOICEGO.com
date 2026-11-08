import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError, qs } from '@/lib/api';
import { Alert, Badge, Button } from './ui';

/**
 * Official FBR reference lists for one invoice line (spec v1.12 §5), loaded through the server
 * (the FBR token never reaches the browser):
 *   sale type (transtypecode) → rate (SaleTypeToRate) → SRO schedule (SroSchedule) → SRO item (SROItem)
 *   HS code → UOM (HS_UOM)
 * Choosing an option fills the line's fields; every field stays editable. The lists load only
 * when the panel is opened, and a failure never blocks the invoice.
 */

interface Province { stateProvinceCode: number; stateProvinceDesc: string }
interface TransType { transactioN_TYPE_ID: number; transactioN_DESC: string }
interface Rate { ratE_ID: number; ratE_DESC: string; ratE_VALUE: number }
interface Sro { srO_ID: number; srO_DESC: string }
interface SroItem { srO_ITEM_ID: number; srO_ITEM_DESC: string }
interface Uom { uoM_ID: number; description: string }
interface RefResp<T> { data: T[]; fetchedAt: string; cached: boolean; stale?: boolean }

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

function useRef_<T>(name: string, params: Record<string, string | number | undefined>, enabled: boolean) {
  return useQuery({
    queryKey: ['fbr-ref', name, params],
    queryFn: () => api<RefResp<T>>(`/api/app/reference/${name}${qs(params)}`),
    enabled,
    retry: false,
    staleTime: 60 * 60_000,
  });
}

function refError(e: unknown): string | null {
  if (!e) return null;
  if (e instanceof ApiError && e.code === 'FBR_NOT_CONFIGURED') return 'Add your FBR token under FBR integration to load the official lists. You can still type the values yourself.';
  if (e instanceof ApiError) return `${e.message}. You can still type the values yourself.`;
  return 'The FBR reference service could not be reached. You can still type the values yourself.';
}

export interface AssistLine {
  saleType: string;
  hsCode: string;
  rate: string;
  uom: string;
  sroScheduleNo: string;
  sroItemSerialNo: string;
}

export function FbrItemAssist({ line, invoiceDate, sellerProvince, onChange }: { line: AssistLine; invoiceDate: string; sellerProvince: string; onChange: (patch: Partial<AssistLine>) => void }) {
  const [open, setOpen] = useState(false);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(invoiceDate) ? invoiceDate : undefined;

  const provinces = useRef_<Province>('provinces', {}, open);
  const provinceCode = provinces.data?.data.find((p) => norm(p.stateProvinceDesc) === norm(sellerProvince))?.stateProvinceCode;
  const trans = useRef_<TransType>('transtypecode', {}, open);
  const transTypeId = trans.data?.data.find((t) => norm(t.transactioN_DESC) === norm(line.saleType))?.transactioN_TYPE_ID;

  const rates = useRef_<Rate>('SaleTypeToRate', { transTypeId, originationSupplier: provinceCode, date }, open && !!transTypeId && !!provinceCode && !!date);
  const rateId = rates.data?.data.find((r) => norm(r.ratE_DESC) === norm(line.rate))?.ratE_ID;
  const sros = useRef_<Sro>('SroSchedule', { rate_id: rateId, date, origination_supplier_csv: provinceCode }, open && !!rateId && !!provinceCode && !!date);
  const sroId = sros.data?.data.find((s) => norm(s.srO_DESC) === norm(line.sroScheduleNo))?.srO_ID;
  const sroItems = useRef_<SroItem>('SROItem', { sro_id: sroId, date }, open && !!sroId && !!date);

  const hs = line.hsCode.trim();
  const hsValid = /^\d{4}\.\d{4}$/.test(hs);
  const uoms = useRef_<Uom>('HS_UOM', { hs_code: hs, annexure_id: 3 }, open && hsValid);
  const uomList = uoms.data?.data ?? [];
  const uomMatches = uomList.some((u) => norm(u.description) === norm(line.uom));

  const baseError = refError(provinces.error) ?? refError(trans.error);

  return (
    <details className="rounded-lg border border-ink-200 bg-ink-50/60 px-3 py-2 sm:col-span-2 lg:col-span-6" onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary className="cursor-pointer text-sm font-medium text-brand-700">Official FBR options for this line</summary>
      {open && (
        <div className="mt-3 space-y-3 text-sm">
          {baseError ? (
            <Alert tone="amber">{baseError}</Alert>
          ) : (
            <>
              {!provinceCode && provinces.data && <Alert tone="amber">Your business province “{sellerProvince}” does not match FBR’s province list. Correct it in Settings → Business profile to load rates and SROs.</Alert>}
              {!date && <Alert tone="amber">Choose the invoice date first.</Alert>}
              <div className="grid gap-3 lg:grid-cols-2">
                <Pick label="Sale type (FBR transaction types)" loading={trans.isLoading} value={transTypeId ? String(transTypeId) : ''} placeholder={line.saleType && !transTypeId ? `“${line.saleType}” is not in FBR’s list — choose one` : 'Choose a sale type'}
                  options={(trans.data?.data ?? []).map((t) => ({ value: String(t.transactioN_TYPE_ID), label: t.transactioN_DESC }))}
                  onPick={(v) => { const t = trans.data!.data.find((x) => String(x.transactioN_TYPE_ID) === v); if (t) onChange({ saleType: t.transactioN_DESC, rate: '', sroScheduleNo: '', sroItemSerialNo: '' }); }} />
                <Pick label="Rate (SaleTypeToRate)" loading={rates.isFetching} disabled={!transTypeId || !provinceCode || !date} error={refError(rates.error)} value={rateId ? String(rateId) : ''}
                  placeholder={!transTypeId ? 'Choose a sale type first' : rates.data && rates.data.data.length === 0 ? 'FBR lists no rate for this sale type' : line.rate && !rateId ? `“${line.rate}” is not an FBR rate for this sale type` : 'Choose a rate'}
                  options={(rates.data?.data ?? []).map((r) => ({ value: String(r.ratE_ID), label: r.ratE_DESC }))}
                  onPick={(v) => { const r = rates.data!.data.find((x) => String(x.ratE_ID) === v); if (r) onChange({ rate: r.ratE_DESC, sroScheduleNo: '', sroItemSerialNo: '' }); }} />
                <Pick label="SRO / schedule (SroSchedule)" loading={sros.isFetching} disabled={!rateId} error={refError(sros.error)} value={sroId ? String(sroId) : ''}
                  placeholder={!rateId ? 'Choose a rate first' : sros.data && sros.data.data.length === 0 ? 'No SRO applies to this rate' : 'Choose an SRO, if one applies'}
                  options={(sros.data?.data ?? []).map((s) => ({ value: String(s.srO_ID), label: s.srO_DESC }))}
                  onPick={(v) => { const s = sros.data!.data.find((x) => String(x.srO_ID) === v); onChange({ sroScheduleNo: s?.srO_DESC ?? '', sroItemSerialNo: '' }); }} allowClear />
                <Pick label="SRO item (SROItem)" loading={sroItems.isFetching} disabled={!sroId} error={refError(sroItems.error)} value={sroItems.data?.data.find((x) => norm(x.srO_ITEM_DESC) === norm(line.sroItemSerialNo)) ? line.sroItemSerialNo : ''}
                  placeholder={!sroId ? 'Choose an SRO first' : 'Choose the item serial number'}
                  options={(sroItems.data?.data ?? []).map((x) => ({ value: x.srO_ITEM_DESC, label: x.srO_ITEM_DESC }))}
                  onPick={(v) => onChange({ sroItemSerialNo: v })} allowClear />
              </div>
            </>
          )}
          <div className="rounded-md border border-ink-200 bg-white px-3 py-2">
            <p className="text-xs font-medium text-ink-700">UOM for HS code {hsValid ? hs : '(enter an HS code like 0101.2100)'} — HS_UOM</p>
            {hsValid && uoms.isFetching && <p className="mt-1 text-xs text-ink-500">Loading…</p>}
            {hsValid && uoms.error && <p className="mt-1 text-xs text-amber-700">{refError(uoms.error)}</p>}
            {hsValid && uoms.data && (uomList.length === 0 ? (
              <p className="mt-1 text-xs text-ink-500">FBR returned no UOM for this HS code.</p>
            ) : (
              <div className="mt-1 flex flex-wrap items-center gap-2">
                {uomMatches ? <Badge tone="green">“{line.uom}” matches FBR</Badge> : line.uom ? <Badge tone="amber">“{line.uom}” is not FBR’s UOM for this HS code</Badge> : null}
                {uomList.filter((u) => norm(u.description) !== norm(line.uom)).map((u) => (
                  <Button key={u.uoM_ID} size="sm" variant="secondary" type="button" onClick={() => onChange({ uom: u.description })}>Use {u.description}</Button>
                ))}
              </div>
            ))}
          </div>
          <p className="text-xs text-ink-500">Lists come from FBR’s reference APIs for your token’s environment and are cached for up to 24 hours.</p>
        </div>
      )}
    </details>
  );
}

function Pick({ label, value, options, onPick, placeholder, disabled, loading, error, allowClear }: { label: string; value: string; options: { value: string; label: string }[]; onPick: (v: string) => void; placeholder: string; disabled?: boolean; loading?: boolean; error?: string | null; allowClear?: boolean }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-ink-700">{label}</span>
      <select className="input py-1.5 text-sm" value={value} disabled={disabled || loading} onChange={(e) => onPick(e.target.value)}>
        <option value="" disabled={!allowClear}>{loading ? 'Loading from FBR…' : placeholder}</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {error && <span className="mt-1 block text-xs text-amber-700">{error}</span>}
    </label>
  );
}
