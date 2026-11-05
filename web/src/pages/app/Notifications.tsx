import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { api } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { Button, Card, EmptyState, PageHeader, Spinner } from '@/components/ui';

interface N { id: string; type: string; title: string; body: string; link: string | null; readAt: string | null; createdAt: string }

export default function Notifications() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['notifications'], queryFn: () => api<{ items: N[]; unread: number }>('/api/app/notifications') });
  const all = useMutation({ mutationFn: () => api('/api/app/notifications/read-all', { body: {} }), onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }) });
  const one = useMutation({ mutationFn: (id: string) => api(`/api/app/notifications/${id}/read`, { body: {} }), onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }) });
  return (
    <div>
      <PageHeader title="Notifications" actions={!!q.data?.unread && <Button variant="secondary" onClick={() => all.mutate()} loading={all.isPending}>Mark all read</Button>} />
      <Card bodyClass="p-0">
        {q.isLoading ? <Spinner /> : !q.data?.items.length ? <EmptyState title="No notifications" /> : (
          <ul className="divide-y divide-ink-100">
            {q.data.items.map((n) => (
              <li key={n.id} className={clsx('flex items-start gap-3 p-4', !n.readAt && 'bg-brand-50/40')}>
                <span className={clsx('mt-1.5 h-2 w-2 shrink-0 rounded-full', n.readAt ? 'bg-transparent' : 'bg-brand-600')} aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{n.link ? <Link to={n.link} className="hover:underline" onClick={() => one.mutate(n.id)}>{n.title}</Link> : n.title}</p>
                  <p className="text-sm text-ink-600">{n.body}</p>
                  <p className="mt-0.5 text-xs text-ink-400">{dateTime(n.createdAt)}</p>
                </div>
                {!n.readAt && <Button size="sm" variant="ghost" onClick={() => one.mutate(n.id)}>Mark read</Button>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
