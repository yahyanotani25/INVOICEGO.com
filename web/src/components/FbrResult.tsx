import { useState } from 'react';
import type { ExplainedIssue } from '@/lib/types';
import { Alert, Badge } from './ui';
import { OUTCOME_TONE } from '@/lib/format';

const OUTCOME_TEXT: Record<string, string> = {
  VALID: 'FBR returned Valid at invoice level and for every item.',
  INVALID: 'FBR returned Invalid. Nothing was recorded; correct the fields below and try again.',
  AUTH_ERROR: 'FBR rejected the token (HTTP 401). The request was not processed.',
  HTTP_ERROR: 'FBR returned an HTTP error. The request was not accepted.',
  NOT_SENT: 'The request could not reach FBR. Nothing was recorded; you can try again.',
  UNCERTAIN: 'The outcome is uncertain (timeout, interrupted connection or server error). Do NOT resubmit until you reconcile it against the IRIS Invoice Dashboard.',
  BAD_RESPONSE: 'FBR returned an unexpected response. Review the raw response.',
};

export function IssueList({ issues }: { issues: ExplainedIssue[] }) {
  if (!issues.length) return null;
  return (
    <ul className="space-y-2">
      {issues.map((i, k) => (
        <li key={k} className="rounded-lg border border-red-200 bg-red-50/60 p-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            {i.code && <Badge tone="red">FBR {i.code}</Badge>}
            {i.itemSNo && <Badge tone="gray">Item {i.itemSNo}</Badge>}
            {i.fieldLabel && <Badge tone="violet">{i.fieldLabel}</Badge>}
            {i.category && <span className="text-[11px] text-ink-500">{i.category === 'PURCHASE' ? 'Purchase error code' : 'Sales error code'}</span>}
          </div>
          <p className="mt-1.5 font-medium text-red-900">{i.message || i.fbrMessage}</p>
          {i.fbrDescription && <p className="mt-0.5 text-ink-700">{i.fbrDescription}</p>}
          {i.action && <p className="mt-1 text-ink-800"><span className="font-medium">What to do: </span>{i.action}</p>}
          {!i.known && i.scope !== 'HTTP' && i.scope !== 'NETWORK' && <p className="mt-1 text-xs text-ink-500">This code is not in the supplied error catalogue; the original FBR text is shown.</p>}
        </li>
      ))}
    </ul>
  );
}

export function FbrResult({ op, outcome, httpStatus, issues, raw, request }: { op: 'VALIDATE' | 'POST'; outcome: string; httpStatus: number | null; issues: ExplainedIssue[]; raw?: string | null; request?: string | null }) {
  const [show, setShow] = useState(false);
  const tone = outcome === 'VALID' ? 'green' : outcome === 'UNCERTAIN' || outcome === 'NOT_SENT' || outcome === 'BAD_RESPONSE' ? 'amber' : 'red';
  return (
    <div className="space-y-3">
      <Alert tone={tone} title={`${op === 'POST' ? 'Submission' : 'Validation'}: ${outcome}${httpStatus ? ` · HTTP ${httpStatus}` : ''}`}>
        {OUTCOME_TEXT[outcome] ?? outcome}
      </Alert>
      <IssueList issues={issues} />
      {(raw || request) && (
        <div>
          <button className="text-xs font-medium text-brand-700 hover:underline" onClick={() => setShow(!show)}>
            {show ? 'Hide' : 'Show'} raw request / response
          </button>
          {show && (
            <div className="mt-2 grid gap-2 lg:grid-cols-2">
              {request && <pre className="max-h-80 overflow-auto rounded-lg bg-ink-900 p-3 text-[11px] text-ink-100">{request}</pre>}
              {raw && <pre className="max-h-80 overflow-auto rounded-lg bg-ink-900 p-3 text-[11px] text-emerald-100">{prettify(raw)}</pre>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function OutcomeBadge({ outcome }: { outcome: string }) {
  return <Badge tone={OUTCOME_TONE[outcome] ?? 'gray'}>{outcome}</Badge>;
}

export function prettify(s: string) {
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return s;
  }
}
