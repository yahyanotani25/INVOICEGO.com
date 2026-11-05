import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { Alert, Badge, Button, Card, Dialog, EmptyState, ErrorBanner, PageHeader, SelectInput, Spinner, Table, TextArea, TextInput } from '@/components/ui';

export interface Ticket { id: string; number: number; title: string; description: string; category: string; queryType: string; priority: string; status: string; createdAt: string; updatedAt: string; messages?: { id: string; body: string; authorIsAdmin: boolean; createdAt: string }[]; attachments?: { id: string; filename: string; size: number; createdAt: string }[] }
export const TICKET_TONE: Record<string, 'blue' | 'amber' | 'green' | 'gray' | 'violet'> = { OPEN: 'blue', IN_PROGRESS: 'violet', AWAITING_USER: 'amber', RESOLVED: 'green', CLOSED: 'gray' };

export default function Support() {
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ title: '', description: '', category: 'TECHNICAL', queryType: 'INTEGRATION', priority: 'NORMAL' });
  const list = useQuery({ queryKey: ['tickets'], queryFn: () => api<Ticket[]>('/api/app/support/tickets') });
  const create = useMutation({ mutationFn: () => api<Ticket>('/api/app/support/tickets', { body: f }), onSuccess: (t) => nav(`/app/support/${t.id}`) });
  return (
    <div className="space-y-5">
      <PageHeader title="Help & support" subtitle="Complaints, messages and technical issues for the InvoiceGO team." actions={<Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> New ticket</Button>} />
      <Alert tone="blue">InvoiceGO tickets are separate from official PRAL DI CRM cases. For FBR/PRAL-side issues, also raise a case at <a className="underline" href="https://dicrm.pral.com.pk" target="_blank" rel="noreferrer">dicrm.pral.com.pk</a>.</Alert>
      <Card bodyClass="p-0">
        {list.isLoading ? <Spinner /> : list.error ? <div className="p-4"><ErrorBanner error={list.error} /></div> : !list.data?.length ? <EmptyState title="No tickets yet" /> : (
          <Table head={<tr><th className="table-th">#</th><th className="table-th">Title</th><th className="table-th">Category</th><th className="table-th">Priority</th><th className="table-th">Status</th><th className="table-th">Updated</th></tr>}>
            {list.data.map((t) => (
              <tr key={t.id}>
                <td className="table-td">{t.number}</td>
                <td className="table-td"><Link className="font-medium text-brand-700 hover:underline" to={`/app/support/${t.id}`}>{t.title}</Link></td>
                <td className="table-td text-xs">{t.category.toLowerCase()} · {t.queryType === 'INTEGRATION' ? 'integration' : 'post-integration'}</td>
                <td className="table-td"><Badge tone={t.priority === 'HIGH' ? 'amber' : 'gray'}>{t.priority.toLowerCase()}</Badge></td>
                <td className="table-td"><Badge tone={TICKET_TONE[t.status]}>{t.status.replace('_', ' ').toLowerCase()}</Badge></td>
                <td className="table-td text-xs">{dateTime(t.updatedAt)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <Dialog open={open} onClose={() => setOpen(false)} title="New support ticket" footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={() => create.mutate()} loading={create.isPending}>Create ticket</Button></>}>
        <ErrorBanner error={create.error} />
        <div className="grid gap-3 sm:grid-cols-3">
          <SelectInput label="Category" required value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} options={[{ value: 'TECHNICAL', label: 'Technical issue' }, { value: 'COMPLAINT', label: 'Complaint' }, { value: 'MESSAGE', label: 'Message' }]} />
          <SelectInput label="Query type" required value={f.queryType} onChange={(e) => setF({ ...f, queryType: e.target.value })} options={[{ value: 'INTEGRATION', label: 'Integration' }, { value: 'POST_INTEGRATION', label: 'Post integration' }]} />
          <SelectInput label="Priority" required value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })} options={[{ value: 'HIGH', label: 'High' }, { value: 'NORMAL', label: 'Normal' }, { value: 'LOW', label: 'Low' }]} />
        </div>
        <TextInput label="Title" required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        <TextArea label="Description" required rows={5} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} hint="You can attach PDF files (max 5 MB each) after the ticket is created." />
      </Dialog>
    </div>
  );
}
