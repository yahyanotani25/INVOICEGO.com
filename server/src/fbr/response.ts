/**
 * Classification of FBR DI responses (spec §4.1.3–4.1.6, §4.2.3–4.2.5).
 *
 * A request is only VALID when ALL hold:
 *   - HTTP 2xx
 *   - validationResponse.statusCode === "00" and validationResponse.status is "Valid" (case-insensitive)
 *   - invoiceStatuses is an array with one entry per submitted item, each statusCode "00"
 *   - for POST: a non-empty root invoiceNumber
 * HTTP 200 alone never means success (see sample "Invalid Response 2": header "00" + item "01").
 */
export type Operation = 'VALIDATE' | 'POST';
export type Outcome = 'VALID' | 'INVALID' | 'AUTH_ERROR' | 'HTTP_ERROR' | 'BAD_RESPONSE' | 'UNCERTAIN' | 'NOT_SENT';

export interface ItemStatus {
  itemSNo: string;
  statusCode: string;
  status: string;
  invoiceNo: string | null;
  errorCode: string | null;
  error: string | null;
}

export interface FbrIssue {
  scope: 'HTTP' | 'INVOICE' | 'ITEM' | 'NETWORK';
  itemSNo?: string;
  code?: string | null;
  message: string;
}

export interface Classified {
  outcome: Outcome;
  invoiceNumber: string | null;
  dated: string | null;
  headerStatusCode: string | null;
  headerStatus: string | null;
  items: ItemStatus[];
  issues: FbrIssue[];
  json: unknown;
}

const code2 = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (s === '') return null;
  return /^\d$/.test(s) ? s.padStart(2, '0') : s;
};
const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

export function classifyResponse(op: Operation, httpStatus: number, bodyText: string, submittedItems: number): Classified {
  const base: Classified = {
    outcome: 'HTTP_ERROR',
    invoiceNumber: null,
    dated: null,
    headerStatusCode: null,
    headerStatus: null,
    items: [],
    issues: [],
    json: null,
  };
  let json: any = null;
  try {
    json = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    json = null;
  }
  base.json = json;

  if (httpStatus === 401 || httpStatus === 403) {
    return { ...base, outcome: 'AUTH_ERROR', issues: [{ scope: 'HTTP', code: String(httpStatus), message: 'Unauthorized: the FBR token was rejected (HTTP ' + httpStatus + ')' }] };
  }
  if (httpStatus >= 500) {
    // The server failed while handling the request; for POST we cannot know whether it was recorded.
    return {
      ...base,
      outcome: op === 'POST' ? 'UNCERTAIN' : 'HTTP_ERROR',
      issues: [{ scope: 'HTTP', code: String(httpStatus), message: `FBR server error (HTTP ${httpStatus}). Internal Server Error (Contact Administrator).` }],
    };
  }
  if (httpStatus < 200 || httpStatus >= 300) {
    return { ...base, outcome: 'HTTP_ERROR', issues: [{ scope: 'HTTP', code: String(httpStatus), message: `Unexpected HTTP status ${httpStatus}` }] };
  }
  if (!json || typeof json !== 'object') {
    return {
      ...base,
      outcome: op === 'POST' ? 'UNCERTAIN' : 'BAD_RESPONSE',
      issues: [{ scope: 'HTTP', message: 'FBR returned HTTP ' + httpStatus + ' but the body is not readable JSON' }],
    };
  }

  const vr = json.validationResponse;
  const invoiceNumber = typeof json.invoiceNumber === 'string' && json.invoiceNumber.trim() ? json.invoiceNumber.trim() : null;
  const dated = str(json.dated);
  if (!vr || typeof vr !== 'object') {
    return {
      ...base,
      invoiceNumber,
      dated,
      outcome: op === 'POST' ? 'UNCERTAIN' : 'BAD_RESPONSE',
      issues: [{ scope: 'INVOICE', message: 'Response has no validationResponse object' }],
    };
  }

  const headerStatusCode = code2(vr.statusCode);
  const headerStatus = str(vr.status);
  const items: ItemStatus[] = Array.isArray(vr.invoiceStatuses)
    ? vr.invoiceStatuses.map((s: any) => ({
        itemSNo: String(s?.itemSNo ?? ''),
        statusCode: code2(s?.statusCode) ?? '',
        status: String(s?.status ?? ''),
        invoiceNo: str(s?.invoiceNo),
        errorCode: str(s?.errorCode) || null,
        error: str(s?.error) || null,
      }))
    : [];

  const issues: FbrIssue[] = [];
  const headerErrCode = str(vr.errorCode) || null;
  const headerErr = str(vr.error) || null;
  if (headerErrCode || headerErr) issues.push({ scope: 'INVOICE', code: headerErrCode, message: headerErr ?? '' });
  for (const it of items) {
    if (it.statusCode !== '00' || !/^valid$/i.test(it.status)) {
      issues.push({ scope: 'ITEM', itemSNo: it.itemSNo, code: it.errorCode, message: it.error ?? `Item ${it.itemSNo} is ${it.status || 'invalid'}` });
    }
  }

  const headerValid = headerStatusCode === '00' && !!headerStatus && /^valid$/i.test(headerStatus);
  const itemsPresent = Array.isArray(vr.invoiceStatuses);
  const itemsValid = itemsPresent && items.length === submittedItems && items.every((i) => i.statusCode === '00' && /^valid$/i.test(i.status));

  let outcome: Outcome;
  if (headerValid && itemsValid) {
    if (op === 'POST' && !invoiceNumber) {
      outcome = 'UNCERTAIN';
      issues.push({ scope: 'INVOICE', message: 'FBR reported Valid but returned no invoiceNumber — reconcile before any reattempt' });
    } else {
      outcome = 'VALID';
    }
  } else if (headerValid && !itemsPresent) {
    outcome = op === 'POST' ? (invoiceNumber ? 'UNCERTAIN' : 'INVALID') : 'BAD_RESPONSE';
    issues.push({ scope: 'INVOICE', message: 'Header is Valid but no item-level results were returned' });
  } else if (headerValid && items.length !== submittedItems) {
    outcome = op === 'POST' && invoiceNumber ? 'UNCERTAIN' : 'INVALID';
    issues.push({ scope: 'INVOICE', message: `FBR returned ${items.length} item results for ${submittedItems} submitted items` });
  } else {
    outcome = 'INVALID';
    if (issues.length === 0) issues.push({ scope: 'INVOICE', message: `FBR status: ${headerStatus ?? 'unknown'} (${headerStatusCode ?? '—'})` });
  }

  return { outcome, invoiceNumber, dated, headerStatusCode, headerStatus, items, issues, json };
}
