import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, qs } from '@/lib/api';
import { Alert, Badge, Button, Card, EmptyState, ErrorBanner, PageHeader, Pagination, Spinner, Table } from '@/components/ui';

interface Row { code: string; description: string; fullDescription: string; chapter: string; source: string; sourceLines: number[]; alternates: { description: string; source: string; line: string }[] }

export default function HsCodes() {
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [showReport, setShowReport] = useState(false);
  const list = useQuery({ queryKey: ['hs', search, page], queryFn: () => api<{ total: number; matchedBy: string; rows: Row[] }>(`/api/app/hs-codes${qs({ q: search, page, pageSize: 25 })}`), placeholderData: (p) => p });
  const report = useQuery({ queryKey: ['hs-report'], queryFn: () => api<{ stats: Record<string, number>; report: any; importedAt: string }>('/api/app/hs-codes/import-report'), enabled: showReport });

  return (
    <div className="space-y-4">
      <PageHeader title="HS / PCT codes" subtitle="Full catalogue imported from the supplied PCT Codes and HS Code documents. Search by code (with or without the dot, leading zeros kept) or by description." actions={<Button variant="secondary" onClick={() => setShowReport(!showReport)}>{showReport ? 'Hide' : 'Show'} import report</Button>} />
      {showReport && (
        <Card title="Import reconciliation">
          {report.isLoading ? <Spinner /> : report.data ? (
            <div className="space-y-3 text-sm">
              <dl className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
                {Object.entries(report.data.stats).map(([k, v]) => <div key={k} className="rounded-lg bg-ink-50 p-2"><dt className="text-xs text-ink-500">{k.replace(/([A-Z])/g, ' $1').toLowerCase()}</dt><dd className="font-semibold tabular-nums">{v}</dd></div>)}
              </dl>
              <Alert tone="blue">Lines that begin with a code but continue a wrapped description (e.g. “8703.2195 , 8703.2240 and”) are merged into the preceding record instead of being treated as new codes. Differing descriptions for the same code are kept as alternates. Descriptions truncated in the source documents are kept verbatim.</Alert>
              <details><summary className="cursor-pointer text-xs font-medium">Continuation lines merged ({report.data.report.continuations?.length})</summary><ul className="mt-1 max-h-60 overflow-auto text-xs">{report.data.report.continuations?.map((c: any) => <li key={c.line}>line {c.line}: “{c.text}” → merged into {c.mergedInto}</li>)}</ul></details>
              <details><summary className="cursor-pointer text-xs font-medium">Codes that appear only inside other descriptions ({report.data.report.codesSeenOnlyInsideContinuationText?.length})</summary><p className="mt-1 text-xs">{report.data.report.codesSeenOnlyInsideContinuationText?.join(', ')} — not imported as standalone records (no description of their own in the source).</p></details>
              <details><summary className="cursor-pointer text-xs font-medium">Records whose description line is empty in the source ({report.data.report.recordsWithEmptyDescriptionLine?.length})</summary><ul className="mt-1 text-xs">{report.data.report.recordsWithEmptyDescriptionLine?.map((r: any) => <li key={r.line}>{r.code} (line {r.line})</li>)}</ul></details>
            </div>
          ) : <ErrorBanner error={report.error} />}
        </Card>
      )}
      <Card bodyClass="p-0">
        <form className="flex flex-wrap gap-2 border-b border-ink-100 p-3" onSubmit={(e) => { e.preventDefault(); setSearch(q); setPage(1); }}>
          <input className="input max-w-md" placeholder="e.g. 0101.2100, 01012100, 1006 or basmati" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search HS codes" />
          <Button type="submit" variant="secondary">Search</Button>
          {list.data && <span className="self-center text-xs text-ink-500">Matched by {list.data.matchedBy}</span>}
        </form>
        {list.isLoading ? <Spinner /> : list.error ? <div className="p-4"><ErrorBanner error={list.error} /></div> : !list.data?.rows.length ? <EmptyState title="No matching codes" /> : (
          <>
            <Table head={<tr><th className="table-th">Code</th><th className="table-th">Description</th><th className="table-th">Source</th></tr>}>
              {list.data.rows.map((r) => (
                <tr key={r.code}>
                  <td className="table-td whitespace-nowrap font-mono font-semibold">{r.code}<div className="text-[11px] font-normal text-ink-500">Chapter {r.chapter}</div></td>
                  <td className="table-td">
                    {r.description}
                    {r.fullDescription !== r.description && <div className="text-xs text-ink-500">Full: {r.fullDescription}</div>}
                    {r.alternates.map((a, k) => <div key={k} className="mt-0.5 text-xs text-amber-700">Alternate ({a.source}, line {a.line}): {a.description}</div>)}
                  </td>
                  <td className="table-td text-xs text-ink-500"><Badge tone="gray">{r.source}</Badge> line {r.sourceLines.join(', ')}</td>
                </tr>
              ))}
            </Table>
            <Pagination page={page} pageSize={25} total={list.data.total} onPage={setPage} />
          </>
        )}
      </Card>
      <p className="text-xs text-ink-500">Whether an HS code is valid for a sale type, and which UOM applies, is decided by FBR (reference APIs HS_UOM and the validation endpoint).</p>
    </div>
  );
}
