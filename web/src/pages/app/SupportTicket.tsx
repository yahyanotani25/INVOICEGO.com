import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Paperclip } from 'lucide-react';
import { api, download } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { Badge, Button, Card, ErrorBanner, PageHeader, Spinner, TextArea, useToast } from '@/components/ui';
import { TICKET_TONE, type Ticket } from './Support';

export default function SupportTicket() {
  const { id } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const [msg, setMsg] = useState('');
  const q = useQuery({ queryKey: ['ticket', id], queryFn: () => api<Ticket>(`/api/app/support/tickets/${id}`) });
  const set = (t: Ticket) => qc.setQueryData(['ticket', id], t);
  const reply = useMutation({ mutationFn: () => api<Ticket>(`/api/app/support/tickets/${id}/messages`, { body: { body: msg } }), onSuccess: (t) => { setMsg(''); set(t); } });
  const attach = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      return api<Ticket>(`/api/app/support/tickets/${id}/attachments`, { form: fd });
    },
    onSuccess: (t) => { set(t); toast('green', 'Attachment uploaded'); },
  });
  const close = useMutation({ mutationFn: () => api<Ticket>(`/api/app/support/tickets/${id}/close`, { body: {} }), onSuccess: set });
  if (q.isLoading) return <Spinner />;
  if (!q.data) return <ErrorBanner error={q.error} />;
  const t = q.data;
  return (
    <div className="space-y-5">
      <PageHeader title={`#${t.number} ${t.title}`} subtitle={<span className="flex flex-wrap gap-2"><Badge tone={TICKET_TONE[t.status]}>{t.status.replace('_', ' ').toLowerCase()}</Badge><Badge>{t.priority.toLowerCase()} priority</Badge><Badge>{t.category.toLowerCase()}</Badge><Badge>{t.queryType === 'INTEGRATION' ? 'integration' : 'post-integration'}</Badge></span>} actions={t.status !== 'CLOSED' && <Button variant="secondary" onClick={() => close.mutate()} loading={close.isPending}>Close ticket</Button>} />
      <Card title="Conversation">
        <div className="space-y-3">
          <div className="rounded-lg bg-ink-50 p-3 text-sm"><p className="text-xs text-ink-500">You · {dateTime(t.createdAt)}</p><p className="mt-1 whitespace-pre-wrap">{t.description}</p></div>
          {t.messages?.map((m) => (
            <div key={m.id} className={clsx('rounded-lg p-3 text-sm', m.authorIsAdmin ? 'ml-6 bg-brand-50' : 'mr-6 bg-ink-50')}>
              <p className="text-xs text-ink-500">{m.authorIsAdmin ? 'InvoiceGO support' : 'You'} · {dateTime(m.createdAt)}</p>
              <p className="mt-1 whitespace-pre-wrap">{m.body}</p>
            </div>
          ))}
        </div>
        {t.status !== 'CLOSED' && (
          <form className="mt-4 space-y-2" onSubmit={(e) => { e.preventDefault(); if (msg.trim()) reply.mutate(); }}>
            <ErrorBanner error={reply.error} />
            <TextArea label="Reply" rows={3} value={msg} onChange={(e) => setMsg(e.target.value)} />
            <Button type="submit" loading={reply.isPending} disabled={!msg.trim()}>Send</Button>
          </form>
        )}
      </Card>
      <Card title="Attachments (PDF, max 5 MB)">
        <ul className="space-y-1 text-sm">
          {t.attachments?.length ? t.attachments.map((a) => (
            <li key={a.id}><button className="text-brand-700 hover:underline" onClick={() => download(`/api/app/support/attachments/${a.id}`, a.filename).catch((e) => toast('red', e.message))}><Paperclip className="mr-1 inline h-3.5 w-3.5" />{a.filename}</button> <span className="text-xs text-ink-500">{(a.size / 1024).toFixed(0)} KB · {dateTime(a.createdAt)}</span></li>
          )) : <li className="text-ink-500">No attachments.</li>}
        </ul>
        {t.status !== 'CLOSED' && (
          <div className="mt-3">
            <ErrorBanner error={attach.error} />
            <label className="text-xs font-medium text-ink-700" htmlFor="att">Add PDF</label>
            <input id="att" type="file" accept="application/pdf,.pdf" className="mt-1 block text-sm" onChange={(e) => { const f = e.target.files?.[0]; if (f) attach.mutate(f); e.target.value = ''; }} />
          </div>
        )}
      </Card>
    </div>
  );
}
