import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCheck, Megaphone } from 'lucide-react';
import type { AdminMe } from '@/lib/auth';
import { dateTime } from '@/lib/format';
import { Alert, Badge, Button, Card, Checkbox, ConfirmDialog, EmptyState, ErrorBanner, PageHeader, SelectInput, Spinner, Table, TextArea, TextInput, useToast } from '@/components/ui';
import { aapi, human } from '@/components/admin/adminApi';

interface Notification { id: string; type: string; title: string; body: string; link: string | null; readAt: string | null; createdAt: string }
interface Announcement { id: string; kind: string; title: string; body: string; startsAt: string; endsAt: string | null; active: boolean; createdAt: string }

export default function AdminNotifications({ me }: { me: AdminMe }) {
  const qc = useQueryClient();
  const toast = useToast();
  const canManage = me.permissions.includes('notifications.manage');
  const notes = useQuery({ queryKey: ['admin-notifications'], queryFn: () => aapi<{ items: Notification[]; unread: number }>('/notifications') });
  const ann = useQuery({ queryKey: ['admin-announcements'], queryFn: () => aapi<Announcement[]>('/announcements'), enabled: canManage });
  const readAll = useMutation({
    mutationFn: () => aapi('/notifications/read-all', { method: 'POST', body: {} }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin-notifications'] }),
  });

  const [kind, setKind] = useState('ANNOUNCEMENT');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [notifyUsers, setNotifyUsers] = useState(false);
  const [emailUsers, setEmailUsers] = useState(false);
  const smtp = useQuery({ queryKey: ['admin-settings'], queryFn: () => aapi<{ environment: { smtpConfigured: boolean } }>('/settings'), retry: false });
  const smtpOn = !!smtp.data?.environment.smtpConfigured;
  const [deactivate, setDeactivate] = useState<Announcement | null>(null);
  const endBeforeStart = !!startsAt && !!endsAt && new Date(endsAt) <= new Date(startsAt);

  const create = useMutation({
    mutationFn: () =>
      aapi('/announcements', {
        body: {
          kind,
          title,
          body,
          ...(startsAt ? { startsAt: new Date(startsAt).toISOString() } : {}),
          ...(endsAt ? { endsAt: new Date(endsAt).toISOString() } : {}),
          notifyUsers,
          emailUsers: emailUsers && smtpOn,
        },
      }),
    onSuccess: () => {
      toast('green', emailUsers && smtpOn ? 'Published and emailed to users (remaining emails continue in the background)' : notifyUsers ? 'Published and sent to all active users' : 'Published as a banner in the business app');
      setTitle('');
      setBody('');
      setStartsAt('');
      setEndsAt('');
      setNotifyUsers(false);
      setEmailUsers(false);
      void qc.invalidateQueries({ queryKey: ['admin-announcements'] });
    },
  });
  const off = useMutation({
    mutationFn: (id: string) => aapi(`/announcements/${id}/deactivate`, { method: 'POST', body: {} }),
    onSuccess: () => {
      setDeactivate(null);
      toast('green', 'Announcement deactivated');
      void qc.invalidateQueries({ queryKey: ['admin-announcements'] });
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!endBeforeStart) create.mutate();
  };

  return (
    <div className="space-y-5">
      <PageHeader title="Notifications & announcements" subtitle="Platform alerts for administrators (new registrations, failed FBR submissions, support activity) and announcements to users. Subscription and payment notifications are not part of this release." />
      <Card
        title={`Administrator notifications${notes.data?.unread ? ` (${notes.data.unread} unread)` : ''}`}
        actions={<Button size="sm" variant="secondary" onClick={() => readAll.mutate()} loading={readAll.isPending} disabled={!notes.data?.unread}><CheckCheck className="h-3.5 w-3.5" /> Mark all read</Button>}
        bodyClass="p-0"
      >
        {notes.isLoading ? <Spinner /> : notes.error ? <div className="p-3"><ErrorBanner error={notes.error} /></div> : notes.data!.items.length === 0 ? <EmptyState title="No notifications yet" /> : (
          <ul className="divide-y divide-ink-100">
            {notes.data!.items.map((n) => (
              <li key={n.id} className="flex flex-wrap items-start justify-between gap-2 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink-900">
                    {!n.readAt && <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-brand-500 align-middle" aria-label="Unread" />}
                    {n.link ? <Link to={n.link} className="hover:underline">{n.title}</Link> : n.title}
                  </p>
                  <p className="text-sm text-ink-600">{n.body}</p>
                </div>
                <div className="text-right">
                  <Badge tone={n.type === 'FBR_SUBMISSION_FAILED' ? 'red' : n.type === 'NEW_REGISTRATION' ? 'green' : 'blue'}>{human(n.type)}</Badge>
                  <p className="mt-1 text-xs text-ink-500">{dateTime(n.createdAt)}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {canManage ? (
        <div className="grid gap-4 xl:grid-cols-[420px_1fr]">
          <Card title="New announcement">
            <form onSubmit={submit} className="space-y-3">
              {create.error && <ErrorBanner error={create.error} />}
              <SelectInput label="Type" required value={kind} onChange={(e) => setKind(e.target.value)} options={[{ value: 'ANNOUNCEMENT', label: 'Announcement' }, { value: 'MAINTENANCE', label: 'System maintenance notice' }]} />
              <TextInput label="Title" required value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
              <TextArea label="Message" required rows={4} value={body} onChange={(e) => setBody(e.target.value)} maxLength={3000} />
              <div className="grid gap-3 sm:grid-cols-2">
                <TextInput label="Starts (optional)" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} hint="Your local time; default now" />
                <TextInput label="Ends (optional)" type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} error={endBeforeStart ? 'Must be after the start' : null} />
              </div>
              <Checkbox label="Also send as a notification to every active user" checked={notifyUsers} onChange={setNotifyUsers} hint="Otherwise it is shown as a banner in the business app while active." />
              <Checkbox
                label="Also email every active user"
                checked={emailUsers && smtpOn}
                onChange={(v) => smtpOn && setEmailUsers(v)}
                hint={smtpOn ? 'Users who turned email notifications off are skipped.' : 'Email is not configured on the server (SMTP), so announcements cannot be emailed.'}
              />
              <Button type="submit" loading={create.isPending} disabled={title.trim().length < 3 || body.trim().length < 3 || endBeforeStart}>
                <Megaphone className="h-4 w-4" /> Publish
              </Button>
            </form>
          </Card>
          <Card title="Announcements" bodyClass="p-0">
            {ann.isLoading ? <Spinner /> : ann.error ? <div className="p-3"><ErrorBanner error={ann.error} /></div> : ann.data!.length === 0 ? <EmptyState title="No announcements yet" /> : (
              <Table head={<tr><th className="table-th">Announcement</th><th className="table-th">Window</th><th className="table-th">State</th><th className="table-th"><span className="sr-only">Actions</span></th></tr>}>
                {ann.data!.map((a) => {
                  const expired = !!a.endsAt && new Date(a.endsAt) < new Date();
                  return (
                    <tr key={a.id}>
                      <td className="table-td">
                        <Badge tone={a.kind === 'MAINTENANCE' ? 'amber' : 'blue'}>{human(a.kind)}</Badge>
                        <p className="mt-1 font-medium">{a.title}</p>
                        <p className="max-w-md text-xs text-ink-600">{a.body}</p>
                      </td>
                      <td className="table-td whitespace-nowrap text-xs">{dateTime(a.startsAt)}<br />→ {a.endsAt ? dateTime(a.endsAt) : 'no end'}</td>
                      <td className="table-td"><Badge tone={a.active && !expired ? 'green' : 'gray'}>{a.active ? (expired ? 'Expired' : 'Active') : 'Deactivated'}</Badge></td>
                      <td className="table-td text-right">{a.active && !expired && <Button size="sm" variant="secondary" onClick={() => setDeactivate(a)}>Deactivate</Button>}</td>
                    </tr>
                  );
                })}
              </Table>
            )}
          </Card>
        </div>
      ) : (
        <Alert tone="blue">Your role cannot publish announcements.</Alert>
      )}
      <ConfirmDialog
        open={!!deactivate}
        title="Deactivate announcement"
        message={<>Stop showing “{deactivate?.title}” to users?</>}
        confirmLabel="Deactivate"
        danger
        onConfirm={() => deactivate && off.mutate(deactivate.id)}
        onClose={() => setDeactivate(null)}
        loading={off.isPending}
      >
        {off.error && <ErrorBanner error={off.error} />}
      </ConfirmDialog>
    </div>
  );
}
