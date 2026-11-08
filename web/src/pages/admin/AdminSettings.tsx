import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AdminMe } from '@/lib/auth';
import { api, ApiError } from '@/lib/api';
import { Alert, Badge, Button, Card, ErrorBanner, PageHeader, Spinner, TextArea, TextInput, issueFor, useToast } from '@/components/ui';
import { aapi } from '@/components/admin/adminApi';

type Key = 'platform' | 'email' | 'api' | 'invoice' | 'backup';
interface SettingsResp {
  settings: Partial<Record<Key, Record<string, unknown>>>;
  environment: {
    appVersion: string;
    node: string;
    latestMigration: string | null;
    smtpConfigured: boolean;
    mailFrom: string;
    fbrAllowedOrigins: string;
    fbrTimeouts: { connectMs: number; responseMs: number };
    backupEncryptionConfigured: boolean;
    backupDir: string;
  };
  logo: { mime: string; updatedAt: string } | null;
  deferred: string[];
}

const DEFAULTS: Record<Key, Record<string, string>> = {
  platform: { softwareName: 'InvoiceGO', companyName: '', companyAddress: '', supportEmail: '', supportPhone: '', logoText: '' },
  email: { fromName: 'InvoiceGO', replyTo: '' },
  api: { connectTimeoutMs: '10000', responseTimeoutMs: '60000', note: '' },
  invoice: { defaultPrefix: 'INV', printFooter: '' },
  backup: { retentionDays: '30', scheduleNote: '' },
};
const NUMERIC = new Set(['connectTimeoutMs', 'responseTimeoutMs', 'retentionDays']);

function SettingForm({ k, title, description, initial, canEdit, children }: { k: Key; title: string; description?: ReactNode; initial?: Record<string, unknown>; canEdit: boolean; children: (v: Record<string, string>, set: (f: string, val: string) => void, err: (f: string) => string | null) => ReactNode }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [v, setV] = useState<Record<string, string>>(DEFAULTS[k]);
  useEffect(() => {
    if (initial) setV({ ...DEFAULTS[k], ...Object.fromEntries(Object.entries(initial).map(([a, b]) => [a, b === null || b === undefined ? '' : String(b)])) });
  }, [initial, k]);
  const save = useMutation({
    mutationFn: () => aapi(`/settings/${k}`, { method: 'PUT', body: Object.fromEntries(Object.entries(v).map(([a, b]) => [a, NUMERIC.has(a) ? Number(b) : b])) }),
    onSuccess: () => {
      toast('green', `${title} saved`);
      void qc.invalidateQueries({ queryKey: ['admin-settings'] });
    },
  });
  const issues = save.error instanceof ApiError ? save.error.issues : [];
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };
  return (
    <Card title={title}>
      <form onSubmit={submit} className="space-y-3">
        {description && <p className="text-xs text-ink-500">{description}</p>}
        {save.error && <ErrorBanner error={save.error} />}
        <fieldset disabled={!canEdit} className="space-y-3">
          {children(v, (f, val) => setV((x) => ({ ...x, [f]: val })), (f) => issueFor(issues, f))}
        </fieldset>
        {canEdit && <Button type="submit" loading={save.isPending}>Save</Button>}
      </form>
    </Card>
  );
}

export default function AdminSettings({ me }: { me: AdminMe }) {
  const q = useQuery({ queryKey: ['admin-settings'], queryFn: () => aapi<SettingsResp>('/settings') });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorBanner error={q.error} />;
  const { settings, environment: env, deferred } = q.data!;
  const canEdit = me.permissions.includes('settings.manage');
  return (
    <div className="space-y-5">
      <PageHeader title="System settings" subtitle={canEdit ? 'Changes are recorded in the audit log.' : 'Read-only: your role cannot change settings.'} />
      <Card title="Software version & environment">
        <dl className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-[220px_1fr]">
          <dt className="text-ink-500">Application version</dt><dd className="font-mono">{env.appVersion}</dd>
          <dt className="text-ink-500">Node.js</dt><dd className="font-mono">{env.node}</dd>
          <dt className="text-ink-500">Latest database migration</dt><dd className="font-mono text-xs">{env.latestMigration ?? '—'}</dd>
          <dt className="text-ink-500">Email (SMTP)</dt><dd>{env.smtpConfigured ? <Badge tone="green">Configured</Badge> : <Badge tone="red">Not configured</Badge>} <span className="ml-1 text-xs text-ink-500">From: {env.mailFrom}</span></dd>
          <dt className="text-ink-500">FBR allowed origins</dt><dd className="font-mono text-xs">{env.fbrAllowedOrigins}</dd>
          <dt className="text-ink-500">FBR HTTP timeouts (active)</dt><dd className="text-xs">connect {env.fbrTimeouts.connectMs} ms · response {env.fbrTimeouts.responseMs} ms</dd>
          <dt className="text-ink-500">Backup encryption</dt><dd>{env.backupEncryptionConfigured ? <Badge tone="green">Key configured</Badge> : <Badge tone="red">Missing BACKUP_ENCRYPTION_KEY</Badge>} <span className="ml-1 font-mono text-xs text-ink-500">{env.backupDir}</span></dd>
        </dl>
        <p className="mt-3 text-xs text-ink-500">Secrets (SMTP password, encryption keys, FBR tokens) are environment variables or encrypted records and are never editable or visible here.</p>
      </Card>
      <PlatformLogo logo={q.data!.logo} canEdit={canEdit} />
      <div className="grid gap-4 lg:grid-cols-2">
        <SettingForm k="platform" title="Website / software & company information" initial={settings.platform} canEdit={canEdit}>
          {(v, set, err) => (
            <>
              <TextInput label="Software name" value={v.softwareName} onChange={(e) => set('softwareName', e.target.value)} error={err('softwareName')} />
              <TextInput label="Logo text" value={v.logoText} onChange={(e) => set('logoText', e.target.value)} hint="Short wordmark text" error={err('logoText')} />
              <TextInput label="Company name" value={v.companyName} onChange={(e) => set('companyName', e.target.value)} error={err('companyName')} />
              <TextArea label="Company address" rows={2} value={v.companyAddress} onChange={(e) => set('companyAddress', e.target.value)} error={err('companyAddress')} />
              <div className="grid gap-3 sm:grid-cols-2">
                <TextInput label="Support email" type="email" value={v.supportEmail} onChange={(e) => set('supportEmail', e.target.value)} error={err('supportEmail')} />
                <TextInput label="Support phone" value={v.supportPhone} onChange={(e) => set('supportPhone', e.target.value)} error={err('supportPhone')} />
              </div>
            </>
          )}
        </SettingForm>
        <SettingForm k="email" title="Email settings" description="Display name and reply-to only. SMTP host and credentials are configured as server environment variables." initial={settings.email} canEdit={canEdit}>
          {(v, set, err) => (
            <>
              <TextInput label="From name" value={v.fromName} onChange={(e) => set('fromName', e.target.value)} error={err('fromName')} />
              <TextInput label="Reply-to address" type="email" value={v.replyTo} onChange={(e) => set('replyTo', e.target.value)} error={err('replyTo')} />
            </>
          )}
        </SettingForm>
        <SettingForm k="api" title="API configuration" description="Recorded platform preferences for FBR calls. The active values come from FBR_HTTP_CONNECT_TIMEOUT_MS / FBR_HTTP_RESPONSE_TIMEOUT_MS (shown above); FBR hosts are restricted by FBR_ALLOWED_ORIGINS." initial={settings.api} canEdit={canEdit}>
          {(v, set, err) => (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <TextInput label="Connect timeout (ms)" type="number" min={1000} max={60000} value={v.connectTimeoutMs} onChange={(e) => set('connectTimeoutMs', e.target.value)} error={err('connectTimeoutMs')} />
                <TextInput label="Response timeout (ms)" type="number" min={5000} max={180000} value={v.responseTimeoutMs} onChange={(e) => set('responseTimeoutMs', e.target.value)} error={err('responseTimeoutMs')} />
              </div>
              <TextArea label="Note" rows={2} value={v.note} onChange={(e) => set('note', e.target.value)} error={err('note')} />
            </>
          )}
        </SettingForm>
        <SettingForm k="invoice" title="Invoice settings" initial={settings.invoice} canEdit={canEdit}>
          {(v, set, err) => (
            <>
              <TextInput label="Default internal number prefix" value={v.defaultPrefix} onChange={(e) => set('defaultPrefix', e.target.value)} hint="1–10 letters, digits or hyphens" error={err('defaultPrefix')} />
              <TextArea label="Print footer" rows={2} value={v.printFooter} onChange={(e) => set('printFooter', e.target.value)} error={err('printFooter')} />
            </>
          )}
        </SettingForm>
        <SettingForm k="backup" title="Backup settings" description="Retention policy and schedule notes. Backups run from the Backups page or a scheduled CLI job (npm run backup:prod)." initial={settings.backup} canEdit={canEdit}>
          {(v, set, err) => (
            <>
              <TextInput label="Retention (days)" type="number" min={1} max={3650} value={v.retentionDays} onChange={(e) => set('retentionDays', e.target.value)} error={err('retentionDays')} />
              <TextArea label="Schedule note" rows={2} value={v.scheduleNote} onChange={(e) => set('scheduleNote', e.target.value)} error={err('scheduleNote')} />
            </>
          )}
        </SettingForm>
        <Card title="Payment gateway settings">
          <Alert tone="amber" title="Deferred">
            {deferred.length ? deferred.join(' · ') : 'Payment gateway settings — deferred (subscriptions are not part of this release).'}
          </Alert>
          <fieldset disabled className="mt-3 opacity-60">
            <TextInput label="Gateway" value="Not available in this release" readOnly />
          </fieldset>
        </Card>
      </div>
    </div>
  );
}

function PlatformLogo({ logo, canEdit }: { logo: SettingsResp['logo']; canEdit: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ['admin-settings'] });
    await qc.invalidateQueries({ queryKey: ['branding'] });
  };
  const upload = useMutation({
    mutationFn: (f: File) => {
      const fd = new FormData();
      fd.append('file', f);
      return api('/api/admin/settings/logo', { form: fd, area: 'admin' });
    },
    onSuccess: async () => { toast('green', 'Logo updated'); await refresh(); },
  });
  const remove = useMutation({ mutationFn: () => api('/api/admin/settings/logo', { method: 'DELETE', area: 'admin' }), onSuccess: async () => { toast('green', 'Logo removed'); await refresh(); } });
  return (
    <Card title="Platform logo">
      <div className="flex flex-wrap items-center gap-4">
        {logo ? <img src={`/api/public/logo?v=${new Date(logo.updatedAt).getTime()}`} alt="Current platform logo" className="h-14 w-auto rounded border border-ink-200 bg-white p-1" /> : <p className="text-sm text-ink-500">No logo uploaded; the default InvoiceGO mark is shown.</p>}
        {canEdit && (
          <div className="space-y-1">
            <input type="file" accept="image/png,image/jpeg,image/webp" aria-label="Upload platform logo" className="text-sm" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate(f); e.target.value = ''; }} />
            <p className="text-xs text-ink-500">PNG, JPEG or WebP, up to 512 KB. Shown on the website, sign-in pages and the business app.</p>
            {logo && <Button size="sm" variant="ghost" onClick={() => remove.mutate()} loading={remove.isPending}>Remove logo</Button>}
          </div>
        )}
      </div>
      <ErrorBanner error={upload.error ?? remove.error} />
    </Card>
  );
}
