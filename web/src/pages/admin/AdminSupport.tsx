import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Paperclip, Send } from 'lucide-react';
import clsx from 'clsx';
import type { AdminMe } from '@/lib/auth';
import { download, qs } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { Badge, Button, Card, EmptyState, ErrorBanner, PageHeader, Pagination, SelectInput, Spinner, Table, TextArea, useToast } from '@/components/ui';
import { aapi, human, TICKET_TONE } from '@/components/admin/adminApi';

const STATUSES = ['OPEN', 'IN_PROGRESS', 'AWAITING_USER', 'RESOLVED', 'CLOSED'];
const PRIORITY_TONE: Record<string, 'red' | 'gray' | 'blue'> = { HIGH: 'red', NORMAL: 'blue', LOW: 'gray' };

interface Ticket {
  id: string;
  number: number;
  title: string;
  description: string;
  category: string;
  queryType: string;
  priority: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  user?: { name: string; email: string };
  businessId?: string;
  business?: { name: string; ntnCnic: string } | null;
  messages?: { id: string; body: string; authorIsAdmin: boolean; createdAt: string }[];
  attachments?: { id: string; filename: string; size: number; createdAt: string }[];
}

export function AdminSupport() {
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const nav = useNavigate();
  const q = useQuery({ queryKey: ['admin-support', status, page], queryFn: () => aapi<{ total: number; rows: Ticket[] }>(`/support${qs({ status, page })}`) });
  return (
    <div>
      <PageHeader title="Customer support" subtitle="Complaints, messages and technical issues raised by businesses. These are InvoiceGO tickets — separate from official PRAL DI CRM cases." />
      <div className="card">
        <div className="flex flex-wrap items-end gap-2 border-b border-ink-100 p-3">
          <SelectInput label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} placeholder="All statuses" options={STATUSES.map((s) => ({ value: s, label: human(s) }))} className="w-52" />
        </div>
        {q.isLoading ? <Spinner /> : q.error ? <div className="p-3"><ErrorBanner error={q.error} /></div> : q.data!.rows.length === 0 ? <EmptyState title="No tickets" /> : (
          <>
            <Table head={<tr><th className="table-th">#</th><th className="table-th">Title</th><th className="table-th">From</th><th className="table-th">Category</th><th className="table-th">Priority</th><th className="table-th">Status</th><th className="table-th">Updated</th></tr>}>
              {q.data!.rows.map((t) => (
                <tr key={t.id} className="cursor-pointer hover:bg-ink-50" onClick={() => nav(`/admin/support/${t.id}`)}>
                  <td className="table-td font-mono text-xs">{t.number}</td>
                  <td className="table-td"><Link to={`/admin/support/${t.id}`} onClick={(e) => e.stopPropagation()} className="font-medium text-brand-700 hover:underline">{t.title}</Link></td>
                  <td className="table-td text-xs">{t.user?.name}<p className="text-ink-500">{t.user?.email}</p></td>
                  <td className="table-td text-xs">{human(t.category)} · {human(t.queryType)}</td>
                  <td className="table-td"><Badge tone={PRIORITY_TONE[t.priority] ?? 'gray'}>{human(t.priority)}</Badge></td>
                  <td className="table-td"><Badge tone={TICKET_TONE[t.status] ?? 'gray'}>{human(t.status)}</Badge></td>
                  <td className="table-td whitespace-nowrap text-xs">{dateTime(t.updatedAt)}</td>
                </tr>
              ))}
            </Table>
            <Pagination page={page} pageSize={25} total={q.data!.total} onPage={setPage} />
          </>
        )}
      </div>
    </div>
  );
}

export function AdminSupportTicket({ me }: { me: AdminMe }) {
  const { id } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['admin-ticket', id], queryFn: () => aapi<Ticket>(`/support/${id}`) });
  const [body, setBody] = useState('');
  const [replyStatus, setReplyStatus] = useState('AWAITING_USER');
  const canReply = me.permissions.includes('support.reply');
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['admin-ticket', id] });
    void qc.invalidateQueries({ queryKey: ['admin-support'] });
  };
  const reply = useMutation({
    mutationFn: () => aapi(`/support/${id}/reply`, { body: { body, status: replyStatus } }),
    onSuccess: () => {
      setBody('');
      toast('green', 'Reply sent — the user has been notified');
      refresh();
    },
  });
  const setMeta = useMutation({
    mutationFn: (v: { status: string; priority?: string }) => aapi(`/support/${id}/status`, { body: v }),
    onSuccess: () => {
      toast('green', 'Ticket updated');
      refresh();
    },
  });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorBanner error={q.error} />;
  const t = q.data!;
  return (
    <div className="space-y-4">
      <Link to="/admin/support" className="inline-flex items-center gap-1 text-sm text-ink-600 hover:text-ink-900"><ArrowLeft className="h-4 w-4" /> Support</Link>
      <PageHeader
        title={`#${t.number} ${t.title}`}
        subtitle={<>{t.user?.name} ({t.user?.email}){t.business ? <> · {t.business.name} ({t.business.ntnCnic})</> : null} · opened {dateTime(t.createdAt)}</>}
        actions={<><Badge tone={PRIORITY_TONE[t.priority] ?? 'gray'}>{human(t.priority)} priority</Badge><Badge tone={TICKET_TONE[t.status] ?? 'gray'}>{human(t.status)}</Badge></>}
      />
      <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
        <div className="space-y-4">
          <Card title={`${human(t.category)} · ${human(t.queryType)}`}>
            <p className="whitespace-pre-wrap text-sm text-ink-800">{t.description}</p>
          </Card>
          <Card title="Correspondence">
            {(t.messages ?? []).length === 0 ? <EmptyState title="No replies yet" /> : (
              <ol className="space-y-3">
                {t.messages!.map((m) => (
                  <li key={m.id} className={clsx('rounded-xl p-3 text-sm', m.authorIsAdmin ? 'ml-6 bg-brand-50 ring-1 ring-brand-100' : 'mr-6 bg-ink-50 ring-1 ring-ink-200')}>
                    <p className="mb-1 text-xs font-medium text-ink-500">{m.authorIsAdmin ? 'InvoiceGO support' : t.user?.name ?? 'User'} · {dateTime(m.createdAt)}</p>
                    <p className="whitespace-pre-wrap">{m.body}</p>
                  </li>
                ))}
              </ol>
            )}
            {canReply && (
              <form className="mt-4 space-y-2 border-t border-ink-100 pt-4" onSubmit={(e) => { e.preventDefault(); reply.mutate(); }}>
                {reply.error && <ErrorBanner error={reply.error} />}
                <TextArea label="Reply" required rows={4} value={body} onChange={(e) => setBody(e.target.value)} />
                <div className="flex flex-wrap items-end gap-2">
                  <SelectInput label="Set status to" value={replyStatus} onChange={(e) => setReplyStatus(e.target.value)} options={STATUSES.map((s) => ({ value: s, label: human(s) }))} className="w-52" />
                  <Button type="submit" loading={reply.isPending} disabled={!body.trim()}><Send className="h-4 w-4" /> Send reply</Button>
                </div>
              </form>
            )}
          </Card>
        </div>
        <div className="space-y-4">
          {canReply && (
            <Card title="Ticket">
              <div className="space-y-3">
                <SelectInput label="Status" value={t.status} onChange={(e) => setMeta.mutate({ status: e.target.value, priority: t.priority })} options={STATUSES.map((s) => ({ value: s, label: human(s) }))} />
                <SelectInput label="Priority" value={t.priority} onChange={(e) => setMeta.mutate({ status: t.status, priority: e.target.value })} options={['HIGH', 'NORMAL', 'LOW'].map((s) => ({ value: s, label: human(s) }))} />
                {setMeta.error && <ErrorBanner error={setMeta.error} />}
              </div>
            </Card>
          )}
          <Card title="Attachments (PDF)">
            {(t.attachments ?? []).length === 0 ? <p className="text-sm text-ink-500">No attachments.</p> : (
              <ul className="space-y-2">
                {t.attachments!.map((a) => (
                  <li key={a.id}>
                    <button
                      className="inline-flex items-center gap-1 text-sm text-brand-700 hover:underline"
                      onClick={() => download(`/api/admin/support/attachments/${a.id}`, a.filename).catch((e) => toast('red', (e as Error).message))}
                    >
                      <Paperclip className="h-3.5 w-3.5" /> {a.filename}
                    </button>
                    <span className="ml-1 text-xs text-ink-500">{(a.size / 1024).toFixed(0)} KB · {dateTime(a.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
