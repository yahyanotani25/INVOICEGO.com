import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError, qs } from './api';
import { useDebounced } from './useDebounced';
import type { Lookups } from './types';
import type { ComboOption } from '@/components/Combobox';

/**
 * Dropdown options for one invoice line or product, from FBR's reference APIs (spec v1.12 §5)
 * through the server (the token never reaches the browser):
 *   sale type (transtypecode) → rate (SaleTypeToRate) → SRO (SroSchedule) → SRO item (SROItem)
 *   HS code → UOM (HS_UOM)
 * When FBR lists are unavailable (no token yet, FBR unreachable) the dropdowns fall back to the
 * values known from the supplied documents, and every field still accepts a typed value.
 */

interface Province { stateProvinceCode: number; stateProvinceDesc: string }
interface TransType { transactioN_TYPE_ID: number; transactioN_DESC: string }
interface Rate { ratE_ID: number; ratE_DESC: string; ratE_VALUE: number }
interface Sro { srO_ID: number; srO_DESC: string }
interface SroItem { srO_ITEM_ID: number; srO_ITEM_DESC: string }
interface Uom { uoM_ID: number; description: string }
interface RefResp<T> { data: T[]; fetchedAt: string; cached: boolean; stale?: boolean }

export const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

function useRef_<T>(name: string, params: Record<string, string | number | undefined>, enabled: boolean) {
  return useQuery({
    queryKey: ['fbr-ref', name, params],
    queryFn: () => api<RefResp<T>>(`/api/app/reference/${name}${qs(params)}`),
    enabled,
    retry: false,
    staleTime: 60 * 60_000,
  });
}

const notConfigured = (e: unknown) => e instanceof ApiError && e.code === 'FBR_NOT_CONFIGURED';
const opts = (xs: string[]): ComboOption[] => [...new Set(xs.filter(Boolean))].map((v) => ({ value: v }));

export interface LineRefInput {
  saleType: string;
  hsCode: string;
  uom: string;
  rate: string;
  sroScheduleNo: string;
  invoiceDate: string;
  sellerProvince: string;
}

export function useLineOptions(line: LineRefInput, L: Lookups | undefined) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(line.invoiceDate) ? line.invoiceDate : undefined;
  const provinces = useRef_<Province>('provinces', {}, true);
  const fbrOff = notConfigured(provinces.error);
  const live = !!provinces.data && !fbrOff;
  const provinceCode = provinces.data?.data.find((p) => norm(p.stateProvinceDesc) === norm(line.sellerProvince))?.stateProvinceCode;

  const trans = useRef_<TransType>('transtypecode', {}, live);
  const transTypeId = trans.data?.data.find((t) => norm(t.transactioN_DESC) === norm(line.saleType))?.transactioN_TYPE_ID;
  const rates = useRef_<Rate>('SaleTypeToRate', { transTypeId, originationSupplier: provinceCode, date }, live && !!transTypeId && !!provinceCode && !!date);
  const rateId = rates.data?.data.find((r) => norm(r.ratE_DESC) === norm(line.rate))?.ratE_ID;
  const sros = useRef_<Sro>('SroSchedule', { rate_id: rateId, date, origination_supplier_csv: provinceCode }, live && !!rateId && !!provinceCode && !!date);
  const sroId = sros.data?.data.find((s) => norm(s.srO_DESC) === norm(line.sroScheduleNo))?.srO_ID;
  const sroItems = useRef_<SroItem>('SROItem', { sro_id: sroId, date }, live && !!sroId && !!date);
  const hs = line.hsCode.trim();
  const uoms = useRef_<Uom>('HS_UOM', { hs_code: hs, annexure_id: 3 }, live && /^\d{4}\.\d{4}$/.test(hs));

  const fromFbr = 'Official list from FBR';
  const fromDocs = fbrOff ? 'Common values — add your FBR token for the official list' : 'Common values';

  const saleTypes = trans.data?.data.length ? { options: trans.data.data.map((t) => ({ value: t.transactioN_DESC })), source: fromFbr } : { options: opts(L?.saleTypes.values ?? []), source: fromDocs };
  const rateList = rates.data?.data.length
    ? { options: rates.data.data.map((r) => ({ value: r.ratE_DESC, description: `Rate ID ${r.ratE_ID}` })), source: `${fromFbr} for this sale type` }
    : { options: opts(L?.rates.values ?? []), source: !transTypeId && live ? 'Choose a sale type from the list to see FBR rates' : fromDocs };
  const sroList = sros.data
    ? { options: sros.data.data.map((s) => ({ value: s.srO_DESC, description: `SRO ID ${s.srO_ID}` })), source: sros.data.data.length ? `${fromFbr} for this rate` : 'FBR lists no SRO for this rate' }
    : { options: opts(L?.sroSchedules.values ?? []), source: !rateId && live ? 'Choose an FBR rate to see its SROs' : fromDocs };
  const sroItemList = sroItems.data
    ? { options: sroItems.data.data.map((x) => ({ value: x.srO_ITEM_DESC, description: `Item ID ${x.srO_ITEM_ID}` })), source: `${fromFbr} for this SRO` }
    : { options: [] as ComboOption[], source: !sroId && live ? 'Choose an FBR SRO to see its items' : fbrOff ? 'Add your FBR token for the official list' : 'Type the item serial number' };
  const uomList = uoms.data?.data.length
    ? { options: uoms.data.data.map((u) => ({ value: u.description, description: 'FBR UOM for this HS code' })), source: `${fromFbr} for HS ${hs}` }
    : { options: opts(L?.uoms.values ?? []), source: fromDocs };
  const fbrUoms = uoms.data?.data.map((u) => u.description) ?? [];

  return {
    fbrOff,
    saleTypes,
    rates: { ...rateList, loading: rates.isFetching },
    sros: { ...sroList, loading: sros.isFetching },
    sroItems: { ...sroItemList, loading: sroItems.isFetching },
    uoms: { ...uomList, loading: uoms.isFetching },
    /** FBR's UOMs for the HS code when the chosen UOM is not one of them (otherwise null). */
    uomMismatch: fbrUoms.length > 0 && !!line.uom.trim() && !fbrUoms.some((u) => norm(u) === norm(line.uom)) ? fbrUoms : null,
  };
}

interface HsRow { code: string; description: string }

/** HS / PCT code search over the 7,494-code catalogue (by code prefix or description). */
export function useHsSearch(current: string) {
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 250);
  const res = useQuery({
    queryKey: ['hs-search', dq],
    queryFn: () => api<{ rows: HsRow[] }>(`/api/app/hs-codes${qs({ q: dq, pageSize: 30 })}`),
    staleTime: 10 * 60_000,
    placeholderData: (p) => p,
  });
  const options: ComboOption[] = (res.data?.rows ?? []).map((r) => ({ value: r.code, description: r.description }));
  // Keep a saved code visible even when it is not in the current search results.
  if (/^\d{4}\.\d{4}$/.test(current) && !options.some((o) => o.value === current)) options.unshift({ value: current });
  return { options, loading: res.isFetching, onQuery: setQ };
}
