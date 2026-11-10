import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { useAuth, type Me } from '@/lib/auth';
import { ACTIVITIES, PROVINCES, SECTORS } from '@/pages/public/Auth';
import { Alert, Button, Card, Checkbox, ErrorBanner, PageHeader, SelectInput, TextInput, issueFor } from './ui';

/**
 * Creates a business owned by the signed-in user. Shown when the user belongs to no business
 * (for example after leaving a team) and available to owners who run more than one business.
 */
export default function CreateBusiness({ firstBusiness }: { firstBusiness: boolean }) {
  const { setMe } = useAuth();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [f, setF] = useState({ name: '', ntnCnic: '', strn: '', address: '', province: 'Punjab', sector: 'All Other Sectors', retailerRegistered: false });
  const [acts, setActs] = useState<string[]>([]);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const issues = err instanceof ApiError ? err.issues : [];
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const m = await api<Me>('/api/auth/businesses', { body: { name: f.name, ntnCnic: f.ntnCnic.trim(), strn: f.strn || null, address: f.address, province: f.province, businessActivities: acts, sector: f.sector, retailerRegistered: f.retailerRegistered } });
      setMe(m);
      // The active business changed: drop cached data from the previous business.
      qc.removeQueries({ predicate: (query) => query.queryKey[0] !== 'me' });
      nav('/app/fbr', { replace: true });
    } catch (e2) {
      setErr(e2);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader title={firstBusiness ? 'Set up your business' : 'Add a business'} subtitle="Enter the details exactly as they appear in your FBR/IRIS profile." />
      {firstBusiness && <Alert tone="blue">You are not a member of any business. Create your own business below, or ask a business owner to invite you to their team.</Alert>}
      <Card>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <ErrorBanner error={err} />
          <div className="grid gap-3 sm:grid-cols-2">
            <TextInput label="Business name" required value={f.name} onChange={set('name')} error={issueFor(issues, 'name')} />
            <TextInput label="NTN / CNIC" required inputMode="numeric" value={f.ntnCnic} onChange={set('ntnCnic')} error={issueFor(issues, 'ntnCnic')} hint="7-digit NTN or 13-digit CNIC" />
            <TextInput label="STRN" value={f.strn} onChange={set('strn')} />
            <SelectInput label="Province" required value={f.province} onChange={set('province')} options={PROVINCES} />
            <TextInput label="Business address" required className="sm:col-span-2" value={f.address} onChange={set('address')} error={issueFor(issues, 'address')} />
            <SelectInput label="Sector" required value={f.sector} onChange={set('sector')} options={SECTORS} hint="Select one sector, as in IRIS" />
          </div>
          <div>
            <p className="mb-1 text-xs font-medium text-ink-700">Business nature<span className="text-red-600">*</span> (select all that apply)</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {ACTIVITIES.map((a) => <Checkbox key={a} label={a} checked={acts.includes(a)} onChange={(v) => setActs(v ? [...acts, a] : acts.filter((x) => x !== a))} />)}
            </div>
            {issueFor(issues, 'businessActivities') && <p className="mt-1 text-xs text-red-600">{issueFor(issues, 'businessActivities')}</p>}
          </div>
          <Checkbox label="Registered as a retailer in my sales tax profile" hint="Required for scenarios SN026–SN028." checked={f.retailerRegistered} onChange={(v) => setF({ ...f, retailerRegistered: v })} />
          <div className="text-right">
            <Button type="submit" loading={busy} disabled={!f.name || !f.ntnCnic || !f.address || acts.length === 0}>Create business</Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
