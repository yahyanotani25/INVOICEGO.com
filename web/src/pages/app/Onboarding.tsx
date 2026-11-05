import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Circle } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { dateTime } from '@/lib/format';
import { Alert, Button, Card, Checkbox, ErrorBanner, PageHeader, SelectInput, Spinner, TextInput, useToast } from '@/components/ui';

interface Profile { integratorChoice: string | null; otherIntegratorName: string | null; technicalContactName: string | null; technicalContactMobile: string | null; technicalContactEmail: string | null; erpProvider: string | null; softwareType: string | null; softwareVersion: string | null; crmUserEmail: string | null; hostingCompany: string | null; hostingCountry: string | null; whitelistIps: string[]; whitelistStatus: string; whitelistNotes: string | null; whitelistUpdatedAt: string | null; checklist: Record<string, boolean> }
interface Resp { profile: Profile | null; server: { outboundIps: string[]; hostingCompany: string; hostingCountry: string }; derived: { sandboxTokenSaved: boolean; sandboxTokenOk: boolean; productionTokenSaved: boolean; productionTokenOk: boolean; scenariosPassed: number } }

const STEPS = [
  { id: 'iris', title: 'Access IRIS', body: 'Sign in to the IRIS portal with your registration number and password (InvoiceGO never asks for your IRIS password).' },
  { id: 'di', title: 'Open Digital Invoicing', body: 'From the IRIS dashboard choose Digital Invoicing.' },
  { id: 'api', title: 'Select API Integration', body: 'On the Integration Mode screen choose API Integration (not Manual Invoice Generation).' },
  { id: 'li', title: 'Choose PRAL or another licensed integrator', body: 'PRAL provides licensed-integrator services and sandbox testing free of cost; other licensed integrators may charge a fee. For other integrators, the integrator must accept your application, and PRAL does not do IP whitelisting.' },
  { id: 'tech', title: 'Provide technical details', body: 'Technical contact person, mobile, email, ERP/system provider, software type (Cloud/On-Premises), software version, CRM user ID (email) for the authorised person, business nature (multiple allowed) and sector (one).' },
  { id: 'ip', title: 'Complete IP whitelisting', body: 'Hosting company, hosting country and 1–3 IP addresses — or upload the .xls sample file (max 1 MB) for more. PRAL accepts or rejects within about 2 working hours.' },
  { id: 'sandboxToken', title: 'Obtain sandbox credentials', body: 'Open Sandbox Environment in IRIS, copy the sandbox token and save it in InvoiceGO → FBR integration.' },
  { id: 'scenarios', title: 'Pass the applicable scenarios', body: 'At least one successful invoice per required scenario (based on your business nature and sector). Use the InvoiceGO sandbox workspace.' },
  { id: 'prodToken', title: 'Obtain production credentials', body: 'After the required scenarios pass, IRIS generates the production token (Production Environment → View Security Token). Save it under FBR integration and verify the connection.' },
  { id: 'prodEnable', title: 'Enable production submission', body: 'Enable production in InvoiceGO and start real-time invoice posting.' },
];

export default function Onboarding() {
  const qc = useQueryClient();
  const toast = useToast();
  const { can } = useAuth();
  const q = useQuery({ queryKey: ['onboarding'], queryFn: () => api<Resp>('/api/app/onboarding') });
  const [p, setP] = useState<Profile | null>(null);
  useEffect(() => {
    if (q.data && !p) setP(q.data.profile ?? { integratorChoice: 'PRAL', otherIntegratorName: '', technicalContactName: '', technicalContactMobile: '', technicalContactEmail: '', erpProvider: 'InvoiceGO', softwareType: 'Cloud', softwareVersion: '1.0', crmUserEmail: '', hostingCompany: q.data.server.hostingCompany, hostingCountry: q.data.server.hostingCountry, whitelistIps: q.data.server.outboundIps.slice(0, 3), whitelistStatus: 'NOT_SUBMITTED', whitelistNotes: '', whitelistUpdatedAt: null, checklist: {} });
  }, [q.data, p]);
  const save = useMutation({
    mutationFn: (x: Profile) => api('/api/app/onboarding', { method: 'PUT', body: { ...x, whitelistIps: x.whitelistIps.filter(Boolean), checklist: x.checklist } }),
    onSuccess: async () => {
      toast('green', 'Onboarding details saved');
      await qc.invalidateQueries({ queryKey: ['onboarding'] });
    },
  });
  if (q.isLoading || !p) return <Spinner />;
  if (!q.data) return <ErrorBanner error={q.error} />;
  const d = q.data.derived;
  const auto: Record<string, boolean> = { sandboxToken: d.sandboxTokenOk, prodToken: d.productionTokenOk, ip: p.whitelistStatus === 'APPROVED' };
  const set = (k: keyof Profile) => (e: { target: { value: string } }) => setP({ ...p, [k]: e.target.value });

  return (
    <div className="space-y-5">
      <PageHeader title="FBR onboarding checklist" subtitle="Official IRIS / PRAL onboarding steps (DI User Manual v1.5). InvoiceGO cannot submit the IRIS application for you; record your progress here." />
      <Card title="Steps">
        <ol className="space-y-3">
          {STEPS.map((s, i) => {
            const done = auto[s.id] ?? !!p.checklist[s.id];
            return (
              <li key={s.id} className="flex gap-3">
                {done ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" aria-label="Done" /> : <Circle className="mt-0.5 h-5 w-5 shrink-0 text-ink-300" aria-label="Not done" />}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{i + 1}. {s.title}</p>
                  <p className="text-sm text-ink-600">{s.body}</p>
                  {s.id === 'scenarios' && <p className="text-xs text-ink-500">{d.scenariosPassed} scenario(s) passed so far · <Link className="text-brand-700 underline" to="/app/sandbox">open workspace</Link></p>}
                  {!(s.id in auto) && can('manage') && <div className="mt-1"><Checkbox label="Mark as done" checked={!!p.checklist[s.id]} onChange={(v) => setP({ ...p, checklist: { ...p.checklist, [s.id]: v } })} /></div>}
                </div>
              </li>
            );
          })}
        </ol>
      </Card>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Technical details for IRIS">
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectInput label="Licensed integrator" value={p.integratorChoice ?? ''} onChange={set('integratorChoice')} options={[{ value: 'PRAL', label: 'PRAL (free of cost)' }, { value: 'OTHER', label: 'Other licensed integrator' }]} />
            {p.integratorChoice === 'OTHER' && <TextInput label="Integrator name" value={p.otherIntegratorName ?? ''} onChange={set('otherIntegratorName')} />}
            <TextInput label="Technical contact person" value={p.technicalContactName ?? ''} onChange={set('technicalContactName')} />
            <TextInput label="Technical contact mobile" value={p.technicalContactMobile ?? ''} onChange={set('technicalContactMobile')} />
            <TextInput label="Technical contact email" type="email" value={p.technicalContactEmail ?? ''} onChange={set('technicalContactEmail')} />
            <TextInput label="ERP / system provider" value={p.erpProvider ?? ''} onChange={set('erpProvider')} />
            <SelectInput label="Software type" value={p.softwareType ?? ''} onChange={set('softwareType')} options={['Cloud', 'On-Premises']} />
            <TextInput label="Software version" value={p.softwareVersion ?? ''} onChange={set('softwareVersion')} />
            <TextInput label="Authorised CRM user ID (email)" type="email" className="sm:col-span-2" value={p.crmUserEmail ?? ''} onChange={set('crmUserEmail')} hint="Used for the PRAL DI CRM (https://dicrm.pral.com.pk). InvoiceGO does not store CRM or IRIS passwords." />
          </div>
        </Card>
        <Card title="IP whitelisting">
          <Alert tone="blue" title="This deployment's server">
            <p>Outbound IP(s) FBR will see: <strong>{q.data.server.outboundIps.length ? q.data.server.outboundIps.join(', ') : 'not configured — ask your administrator'}</strong></p>
            <p>Hosting company: <strong>{q.data.server.hostingCompany || '—'}</strong> · Country: <strong>{q.data.server.hostingCountry || '—'}</strong></p>
            <p className="mt-1">Whitelist these exact IPs in IRIS. IRIS accepts 1–3 IPs on the form, or an .xls upload (≤ 1 MB) for more.</p>
          </Alert>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <TextInput label="Hosting server company" value={p.hostingCompany ?? ''} onChange={set('hostingCompany')} />
            <TextInput label="Hosting server country" value={p.hostingCountry ?? ''} onChange={set('hostingCountry')} />
            {[0, 1, 2].map((i) => (
              <TextInput key={i} label={`IP address ${i + 1}`} value={p.whitelistIps[i] ?? ''} onChange={(e) => { const ips = [...p.whitelistIps]; ips[i] = e.target.value.trim(); setP({ ...p, whitelistIps: ips }); }} placeholder="e.g. 203.0.113.10" />
            ))}
            <SelectInput label="Whitelisting status (as shown in IRIS)" value={p.whitelistStatus} onChange={set('whitelistStatus')} options={[{ value: 'NOT_SUBMITTED', label: 'Not submitted' }, { value: 'SUBMITTED', label: 'Submitted — awaiting PRAL' }, { value: 'APPROVED', label: 'Approved' }, { value: 'REJECTED', label: 'Rejected' }]} hint={p.whitelistUpdatedAt ? `Updated ${dateTime(p.whitelistUpdatedAt)}` : 'Recorded manually'} />
            <TextInput label="Notes" className="sm:col-span-2" value={p.whitelistNotes ?? ''} onChange={set('whitelistNotes')} />
          </div>
        </Card>
      </div>
      {can('manage') && (
        <div className="flex justify-end gap-2">
          <ErrorBanner error={save.error} />
          <Button onClick={() => save.mutate(p)} loading={save.isPending}>Save onboarding details</Button>
        </div>
      )}
      <Card title="Support from PRAL">
        <p className="text-sm text-ink-600">For integration and post-integration issues with FBR/PRAL, raise a case in the PRAL DI CRM at <a className="text-brand-700 underline" href="https://dicrm.pral.com.pk" target="_blank" rel="noreferrer">dicrm.pral.com.pk</a> (priority, query type, title, description, PDF attachments). InvoiceGO support tickets are separate and handled by the InvoiceGO team.</p>
      </Card>
    </div>
  );
}
