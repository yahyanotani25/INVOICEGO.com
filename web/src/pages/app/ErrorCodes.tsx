import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, qs } from '@/lib/api';
import { Badge, Card, ErrorBanner, PageHeader, Spinner, Table } from '@/components/ui';

interface Row { id: string; category: string; code: string; messageDesc: string; briefMsgDesc: string; field: string | null; action: string; occurrences: number; sourcePages: number[]; variants: { messageDesc: string; briefMsgDesc: string; sourcePage: number }[] }

export default function ErrorCodes() {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const list = useQuery({ queryKey: ['error-codes', q, cat], queryFn: () => api<Row[]>(`/api/app/error-codes${qs({ q, category: cat })}`), placeholderData: (p) => p });
  return (
    <div>
      <PageHeader title="FBR error codes" subtitle="Complete sales (§7) and purchase (§8) error catalogue from the DI API spec v1.12, with the original FBR wording and InvoiceGO guidance." />
      <Card bodyClass="p-0">
        <div className="flex flex-wrap gap-2 border-b border-ink-100 p-3">
          <input className="input max-w-sm" placeholder="Search code or message" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search error codes" />
          <select className="input w-auto" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Category"><option value="">All</option><option value="SALES">Sales</option><option value="PURCHASE">Purchase</option></select>
          {list.data && <span className="self-center text-xs text-ink-500">{list.data.length} codes</span>}
        </div>
        {list.isLoading ? <Spinner /> : list.error ? <div className="p-4"><ErrorBanner error={list.error} /></div> : (
          <Table head={<tr><th className="table-th">Code</th><th className="table-th">FBR message</th><th className="table-th">FBR description</th><th className="table-th">What to do</th><th className="table-th">Source</th></tr>}>
            {list.data?.map((r) => (
              <tr key={r.id} className="align-top">
                <td className="table-td"><span className="font-mono font-semibold">{r.code}</span><div><Badge tone={r.category === 'SALES' ? 'violet' : 'blue'}>{r.category.toLowerCase()}</Badge></div></td>
                <td className="table-td">{r.messageDesc}</td>
                <td className="table-td text-ink-600">{r.briefMsgDesc}{r.variants.map((v, k) => <div key={k} className="mt-1 text-xs text-amber-700">Variant p.{v.sourcePage}: {v.messageDesc}</div>)}</td>
                <td className="table-td text-ink-700">{r.action}{r.field && <div className="mt-1 text-xs text-ink-500">Field: {r.field}</div>}</td>
                <td className="table-td text-xs text-ink-500">p.{[...new Set(r.sourcePages)].join(', ')}{r.occurrences > 1 && ` · listed ${r.occurrences}×`}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
