import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DatabaseBackup } from 'lucide-react';
import type { AdminMe } from '@/lib/auth';
import { dateTime } from '@/lib/format';
import { Alert, Badge, Button, Card, ConfirmDialog, EmptyState, ErrorBanner, PageHeader, Spinner, Table, useToast } from '@/components/ui';
import { aapi } from '@/components/admin/adminApi';

interface BackupRow { id: string; status: string; fileName: string | null; sizeBytes: string | null; sha256: string | null; error: string | null; startedAt: string; finishedAt: string | null }

const size = (b: string | null) => {
  if (!b) return '—';
  const n = Number(b);
  return n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${(n / 1024).toFixed(0)} KB`;
};

export default function AdminBackups({ me }: { me: AdminMe }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const canRun = me.permissions.includes('backups.manage');
  const q = useQuery({
    queryKey: ['admin-backups'],
    queryFn: () => aapi<{ encryptionConfigured: boolean; supported?: boolean; unsupportedReason?: string | null; rows: BackupRow[] }>('/backups'),
    refetchInterval: (query) => (query.state.data?.rows.some((r) => r.status === 'RUNNING') ? 5000 : false),
  });
  const run = useMutation({
    mutationFn: () => aapi('/backups/run', { method: 'POST', body: {} }),
    onSuccess: () => {
      toast('green', 'Backup queued — it will appear below when it starts');
      setOpen(false);
      setTimeout(() => void qc.invalidateQueries({ queryKey: ['admin-backups'] }), 2000);
    },
  });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorBanner error={q.error} />;
  const d = q.data!;
  return (
    <div className="space-y-4">
      <PageHeader
        title="Backups"
        subtitle="Encrypted PostgreSQL backups (pg_dump custom format, AES-256-GCM). Financial and audit records are included."
        actions={canRun && d.supported !== false && <Button onClick={() => setOpen(true)} disabled={!d.encryptionConfigured}><DatabaseBackup className="h-4 w-4" /> Run encrypted backup now</Button>}
      />
      {d.supported === false && <Alert tone="amber" title="Backups are handled by the database provider on this deployment">{d.unsupportedReason}</Alert>}
      {d.supported !== false && !d.encryptionConfigured && <Alert tone="red" title="Backups disabled">Set BACKUP_ENCRYPTION_KEY (32 bytes, base64) on the server. Unencrypted backups are never produced.</Alert>}
      <Alert tone="blue" title="Restore is CLI-only">
        For safety, restoring is not possible from the web panel. On the server, restore into a <strong>new</strong> database first and verify it before switching traffic:
        <code className="mt-1 block break-all rounded bg-white/70 px-2 py-1 font-mono text-[11px]">npx tsx scripts/restore.ts --file backups/invoicego-…dump.enc --target-url postgresql://… --confirm</code>
        Copy backup files off the server (e.g. to encrypted object storage) according to the retention policy in System settings.
      </Alert>
      <Card title="Backup history" bodyClass="p-0">
        {d.rows.length === 0 ? <EmptyState title="No backups have been run yet" /> : (
          <Table head={<tr><th className="table-th">Started</th><th className="table-th">Finished</th><th className="table-th">Status</th><th className="table-th">File</th><th className="table-th">Size (before encryption)</th><th className="table-th">SHA-256 (plaintext dump)</th></tr>}>
            {d.rows.map((b) => (
              <tr key={b.id}>
                <td className="table-td whitespace-nowrap text-xs">{dateTime(b.startedAt)}</td>
                <td className="table-td whitespace-nowrap text-xs">{dateTime(b.finishedAt)}</td>
                <td className="table-td"><Badge tone={b.status === 'SUCCEEDED' ? 'green' : b.status === 'FAILED' ? 'red' : 'blue'}>{b.status}</Badge>{b.error && <p className="mt-1 max-w-xs text-xs text-red-700">{b.error}</p>}</td>
                <td className="table-td font-mono text-xs">{b.fileName ?? '—'}</td>
                <td className="table-td text-xs">{size(b.sizeBytes)}</td>
                <td className="table-td max-w-[200px] truncate font-mono text-[11px] text-ink-500" title={b.sha256 ?? ''}>{b.sha256 ?? '—'}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <ConfirmDialog open={open} title="Run encrypted backup" message="A full database backup will be written to the server's backup directory, encrypted with the configured backup key. This may take a while on large databases." confirmLabel="Start backup" onConfirm={() => run.mutate()} onClose={() => setOpen(false)} loading={run.isPending}>
        {run.error && <ErrorBanner error={run.error} />}
      </ConfirmDialog>
    </div>
  );
}
