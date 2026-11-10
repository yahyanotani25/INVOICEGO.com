import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, PlugZap } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { dateTime } from '@/lib/format';
import { Alert, Badge, Button, Card, ConfirmDialog, EnvBadge, ErrorBanner, PageHeader, Spinner, Table, TextInput, useToast } from '@/components/ui';
import { OutcomeBadge } from '@/components/FbrResult';

interface Cred { environment: 'SANDBOX' | 'PRODUCTION'; postUrl: string; validateUrl: string; defaults: { postUrl: string; validateUrl: string }; tokenMasked: string | null; tokenSaved: boolean; tokenUpdatedAt: string | null; status: string; lastCheckedAt: string | null; lastCheckMessage: string | null; lastCheckHttpStatus: number | null }
interface CredResp { credentials: Cred[]; productionEnabled: boolean; productionEnabledAt: string | null; allowedOrigins: string[] }

export default function FbrIntegration() {
  const qc = useQueryClient();
  const { can, refresh } = useAuth();
  const toast = useToast();
  const q = useQuery({ queryKey: ['fbr-creds'], queryFn: () => api<CredResp>('/api/app/fbr/credentials') });
  const attempts = useQuery({ queryKey: ['fbr-attempts'], queryFn: () => api<{ rows: { id: string; operation: string; environment: string; outcome: string; httpStatus: number | null; startedAt: string; internalNumber: string | null; invoiceId: string | null }[] }>('/api/app/fbr/attempts') });
  const [confirmEnable, setConfirmEnable] = useState(false);
  const enable = useMutation({
    mutationFn: (on: boolean) => api(`/api/app/fbr/production/${on ? 'enable' : 'disable'}`, { body: on ? { confirm: true } : {} }),
    onSuccess: async () => {
      setConfirmEnable(false);
      await qc.invalidateQueries({ queryKey: ['fbr-creds'] });
      await refresh();
      toast('green', 'Production setting updated');
    },
  });
  if (q.isLoading) return <Spinner />;
  if (!q.data) return <ErrorBanner error={q.error} />;
  const prod = q.data.credentials.find((c) => c.environment === 'PRODUCTION')!;
  return (
    <div className="space-y-5">
      <PageHeader title="FBR integration" subtitle="Your own FBR Digital Invoicing credentials from IRIS. Tokens are encrypted on the server, never shown in full and never sent to the browser." />
      <IrisDetails />
      <div className="grid gap-5 xl:grid-cols-2">
        {q.data.credentials.map((c) => <CredentialCard key={c.environment} c={c} canManage={can('fbr')} />)}
      </div>
      <Card title="Production submission">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-ink-700">
            {q.data.productionEnabled ? <>Production submission is <Badge tone="green">enabled</Badge> since {dateTime(q.data.productionEnabledAt)}.</> : <>Production submission is <Badge tone="amber">disabled</Badge>. Enable it after IRIS has issued your production token and the connection test succeeds.</>}
            <p className="mt-1 text-xs text-ink-500">The sandbox workspace always uses the sandbox URLs and token; production invoices always use the production URLs and token. Replacing the production token disables production until it is tested again.</p>
          </div>
          {can('fbr') && (q.data.productionEnabled ? (
            <Button variant="secondary" onClick={() => enable.mutate(false)} loading={enable.isPending}>Disable production</Button>
          ) : (
            <Button onClick={() => setConfirmEnable(true)} disabled={prod.status !== 'OK'} title={prod.status !== 'OK' ? 'Test the production token first' : ''}>Enable production</Button>
          ))}
        </div>
        <ErrorBanner error={enable.error} />
      </Card>
      <Card title="Recent FBR calls" bodyClass="p-0">
        <Table head={<tr><th className="table-th">When</th><th className="table-th">Environment</th><th className="table-th">Operation</th><th className="table-th">Outcome</th><th className="table-th">Invoice</th></tr>}>
          {attempts.data?.rows.map((a) => (
            <tr key={a.id}><td className="table-td text-xs">{dateTime(a.startedAt)}</td><td className="table-td"><EnvBadge env={a.environment} /></td><td className="table-td text-xs">{a.operation}</td><td className="table-td"><OutcomeBadge outcome={a.outcome} /> <span className="text-xs text-ink-500">{a.httpStatus ? `HTTP ${a.httpStatus}` : ''}</span></td><td className="table-td text-xs">{a.invoiceId ? <Link className="text-brand-700 hover:underline" to={`/app/invoices/${a.invoiceId}`}>{a.internalNumber}</Link> : '—'}</td></tr>
          ))}
        </Table>
      </Card>
      <ConfirmDialog open={confirmEnable} onClose={() => setConfirmEnable(false)} title="Enable production submission?" confirmLabel="Enable production" danger loading={enable.isPending} onConfirm={() => enable.mutate(true)} message="Production invoices are real tax documents reported to FBR. Make sure your required sandbox scenarios have passed and IRIS shows your production token." />
    </div>
  );
}

function CredentialCard({ c, canManage }: { c: Cred; canManage: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [postUrl, setPostUrl] = useState(c.postUrl);
  const [validateUrl, setValidateUrl] = useState(c.validateUrl);
  const [token, setToken] = useState('');
  const [confirmRemove, setConfirmRemove] = useState(false);
  const env = c.environment.toLowerCase();
  const save = useMutation({
    mutationFn: () => api(`/api/app/fbr/credentials/${env}`, { method: 'PUT', body: { postUrl, validateUrl, ...(token ? { token } : {}) } }),
    onSuccess: async () => {
      setToken('');
      toast('green', `${c.environment === 'SANDBOX' ? 'Sandbox' : 'Production'} settings saved`);
      await qc.invalidateQueries({ queryKey: ['fbr-creds'] });
    },
  });
  const test = useMutation({
    mutationFn: () => api<{ result: { status: string; message: string } }>(`/api/app/fbr/credentials/${env}/test`, { body: {} }),
    onSuccess: async (r) => {
      toast(r.result.status === 'OK' ? 'green' : 'red', r.result.message);
      await qc.invalidateQueries({ queryKey: ['fbr-creds'] });
      await qc.invalidateQueries({ queryKey: ['fbr-attempts'] });
    },
  });
  const remove = useMutation({
    mutationFn: () => api(`/api/app/fbr/credentials/${env}/token`, { method: 'DELETE' }),
    onSuccess: async () => {
      setConfirmRemove(false);
      await qc.invalidateQueries({ queryKey: ['fbr-creds'] });
    },
  });
  const tone = c.status === 'OK' ? 'green' : c.status === 'UNTESTED' ? 'amber' : 'red';
  return (
    <Card title={<div className="flex items-center gap-2"><EnvBadge env={c.environment} /><span className="text-sm font-semibold">{c.environment === 'SANDBOX' ? 'Sandbox' : 'Production'} credentials</span></div>} actions={<Badge tone={tone}>{c.tokenSaved ? c.status : 'No token'}</Badge>}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <ErrorBanner error={save.error} />
        <TextInput label={`${c.environment === 'SANDBOX' ? 'Sandbox' : 'Production'} URL (post)`} value={postUrl} onChange={(e) => setPostUrl(e.target.value)} disabled={!canManage} hint={`Default: ${c.defaults.postUrl}`} />
        <TextInput label={`${c.environment === 'SANDBOX' ? 'Sandbox' : 'Production'} validation URL`} value={validateUrl} onChange={(e) => setValidateUrl(e.target.value)} disabled={!canManage} hint={`Default: ${c.defaults.validateUrl}`} />
        <TextInput label={`${c.environment === 'SANDBOX' ? 'Sandbox' : 'Production'} token / API key`} type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} disabled={!canManage} placeholder={c.tokenMasked ? `Saved: ${c.tokenMasked} — enter a new token to replace` : 'Paste the security token from IRIS'} hint={c.tokenUpdatedAt ? `Token updated ${dateTime(c.tokenUpdatedAt)}` : 'Sent only as “Authorization: Bearer …” from the server'} />
        {canManage && (
          <div className="flex flex-wrap gap-2">
            <Button type="submit" loading={save.isPending}><KeyRound className="h-4 w-4" /> Save</Button>
            <Button type="button" variant="secondary" onClick={() => test.mutate()} loading={test.isPending} disabled={!c.tokenSaved}><PlugZap className="h-4 w-4" /> Verify connection</Button>
            {c.tokenSaved && <Button type="button" variant="ghost" onClick={() => setConfirmRemove(true)}>Remove token</Button>}
          </div>
        )}
        <div className="rounded-lg bg-ink-50 p-3 text-xs text-ink-600">
          <p><span className="font-medium">Connection status:</span> {c.lastCheckMessage ?? 'Not tested yet'}</p>
          <p className="mt-0.5"><span className="font-medium">Last checked:</span> {dateTime(c.lastCheckedAt)}{c.lastCheckHttpStatus ? ` · HTTP ${c.lastCheckHttpStatus}` : ''}</p>
          <p className="mt-1 text-ink-500">Verification calls the FBR Provinces reference API with this token. It never creates an invoice. Only <code>https://gw.fbr.gov.pk</code> with the documented paths is accepted.</p>
        </div>
      </form>
      <ConfirmDialog open={confirmRemove} onClose={() => setConfirmRemove(false)} title="Remove token?" danger confirmLabel="Remove" loading={remove.isPending} onConfirm={() => remove.mutate()} message={c.environment === 'PRODUCTION' ? 'Production submission will be disabled.' : 'Sandbox validation and submission will stop until a token is saved again.'} />
    </Card>
  );
}

/** What to enter in IRIS (Digital Invoicing → API Integration → technical details and IP whitelisting). */
function IrisDetails() {
  const toast = useToast();
  const q = useQuery({ queryKey: ['onboarding-server'], queryFn: () => api<{ server: { outboundIps: string[]; hostingCompany: string; hostingCountry: string } }>('/api/app/onboarding') });
  const srv = q.data?.server;
  const rows: [string, string][] = [
    ['Integrator', 'PRAL'],
    ['ERP / software provider', 'InvoiceGO'],
    ['Software type', 'Cloud'],
    ['Hosting company', srv?.hostingCompany || 'Ask your administrator'],
    ['Hosting country', srv?.hostingCountry || 'Ask your administrator'],
    ['IP address(es) to whitelist', srv?.outboundIps.length ? srv.outboundIps.join(', ') : 'Not configured yet — ask your administrator'],
  ];
  const copy = async (v: string) => {
    try {
      await navigator.clipboard.writeText(v);
      toast('green', 'Copied');
    } catch {
      toast('red', 'Copy failed — select the text and copy it');
    }
  };
  return (
    <Card title="Details to enter in IRIS">
      <p className="mb-3 text-sm text-ink-600">In IRIS open <strong>Digital Invoicing → API Integration</strong>, choose PRAL, fill in your technical contact, and use these values. PRAL usually approves IP whitelisting within a few working hours.</p>
      {q.error ? <ErrorBanner error={q.error} /> : (
        <dl className="divide-y divide-ink-100 rounded-lg border border-ink-200">
          {rows.map(([k, v]) => (
            <div key={k} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
              <dt className="text-ink-500">{k}</dt>
              <dd className="flex items-center gap-2 font-medium text-ink-900">
                <span className="break-all">{v}</span>
                {!v.startsWith('Ask') && !v.startsWith('Not configured') && <button type="button" onClick={() => copy(v)} className="rounded px-1.5 py-0.5 text-xs text-brand-700 hover:bg-brand-50">Copy</button>}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </Card>
  );
}
