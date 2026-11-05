import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Download, Upload } from 'lucide-react';
import { api, download } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { dateTime } from '@/lib/format';
import { Alert, Badge, Button, Card, EmptyState, EnvBadge, ErrorBanner, PageHeader, SelectInput, Spinner, Table, useToast } from '@/components/ui';

interface Job { id: string; filename: string; environment: string; status: string; totalInvoices: number; totalRows: number; counts: Record<string, number>; createdAt: string }

export default function Bulk() {
  const nav = useNavigate();
  const toast = useToast();
  const { me, can } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [env, setEnv] = useState<'SANDBOX' | 'PRODUCTION'>(me?.business?.productionEnabled ? 'PRODUCTION' : 'SANDBOX');
  const [file, setFile] = useState<File | null>(null);
  const jobs = useQuery({ queryKey: ['bulk-jobs'], queryFn: () => api<Job[]>('/api/app/bulk/jobs') });
  const upload = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      fd.append('environment', env);
      fd.append('file', file!);
      return api<{ id: string }>('/api/app/bulk/upload', { form: fd });
    },
    onSuccess: (r) => nav(`/app/bulk/${r.id}`),
  });
  return (
    <div className="space-y-5">
      <PageHeader title="Excel bulk upload" subtitle="Upload many invoices at once (multiple items each), check them, validate with FBR and submit the ones you choose." />
      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="1. Download the template">
          <p className="text-sm text-ink-600">One row per invoice item. Rows sharing an <code>import_ref</code> become one invoice. Includes instructions, required/optional column guidance and an example.</p>
          <Button className="mt-3" variant="secondary" onClick={() => download('/api/app/bulk/template', 'invoicego-bulk-template.xlsx').catch((e) => toast('red', e.message))}>
            <Download className="h-4 w-4" /> Download template (.xlsx)
          </Button>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-ink-500">
            <li>Dates must be in the current month (Pakistan time).</li>
            <li>Keep NTN/CNIC and HS code columns as Text so leading zeros are preserved.</li>
            <li>Paste values only — formulas are rejected.</li>
            <li>Up to 500 invoices / 5,000 rows / 5 MB per file.</li>
          </ul>
        </Card>
        <Card title="2. Upload and preview" className="lg:col-span-2">
          {!can('write') ? <Alert tone="amber">Your role cannot upload invoices.</Alert> : (
            <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (file) upload.mutate(); }}>
              <ErrorBanner error={upload.error} />
              <div className="grid gap-3 sm:grid-cols-2">
                <SelectInput label="Environment" required value={env} onChange={(e) => setEnv(e.target.value as 'SANDBOX')} options={[{ value: 'SANDBOX', label: 'Sandbox (scenario_id column required)' }, { value: 'PRODUCTION', label: me?.business?.productionEnabled ? 'Production' : 'Production (not enabled)' }]} />
                <div>
                  <label className="block text-xs font-medium text-ink-700" htmlFor="bulk-file">Workbook (.xlsx)<span className="text-red-600">*</span></label>
                  <input id="bulk-file" ref={fileRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="mt-1 block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-brand-700" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                </div>
              </div>
              <Button type="submit" disabled={!file || (env === 'PRODUCTION' && !me?.business?.productionEnabled)} loading={upload.isPending}>
                <Upload className="h-4 w-4" /> Upload & check
              </Button>
              <p className="text-xs text-ink-500">Nothing is sent to FBR at this step. You will see every invoice with row-level errors first.</p>
            </form>
          )}
        </Card>
      </div>
      <Card title="Previous uploads" bodyClass="p-0">
        {jobs.isLoading ? <Spinner /> : !jobs.data?.length ? <EmptyState title="No uploads yet" /> : (
          <Table head={<tr><th className="table-th">File</th><th className="table-th">Environment</th><th className="table-th">Invoices</th><th className="table-th">Status</th><th className="table-th">Uploaded</th></tr>}>
            {jobs.data.map((j) => (
              <tr key={j.id}>
                <td className="table-td"><Link to={`/app/bulk/${j.id}`} className="font-medium text-brand-700 hover:underline">{j.filename}</Link></td>
                <td className="table-td"><EnvBadge env={j.environment} /></td>
                <td className="table-td text-xs">{j.totalInvoices} invoices · {j.totalRows} rows<div className="mt-0.5 flex flex-wrap gap-1">{Object.entries(j.counts ?? {}).map(([k, v]) => <Badge key={k} tone={k === 'ACCEPTED' ? 'green' : /INVALID|REJECTED|ERROR/.test(k) ? 'red' : 'gray'}>{k.replace(/_/g, ' ').toLowerCase()}: {v}</Badge>)}</div></td>
                <td className="table-td"><Badge>{j.status}</Badge></td>
                <td className="table-td text-xs">{dateTime(j.createdAt)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
