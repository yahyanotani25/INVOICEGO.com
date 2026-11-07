import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { useAuth, type Me } from '@/lib/auth';
import { Alert, Button, Checkbox, ErrorBanner, SelectInput, TextInput, issueFor } from '@/components/ui';

const ACTIVITIES = ['Manufacturer', 'Importer', 'Distributor', 'Wholesaler', 'Exporter', 'Retailer', 'Service Provider', 'Other'];
const SECTORS = ['All Other Sectors', 'Steel', 'FMCG', 'Textile', 'Telecom', 'Petroleum', 'Electricity Distribution', 'Gas Distribution', 'Services', 'Automobile', 'CNG Stations', 'Pharmaceuticals', 'Wholesale / Retails'];
const PROVINCES = ['Punjab', 'Sindh', 'Khyber Pakhtunkhwa', 'Balochistan', 'Capital Territory', 'Gilgit Baltistan', 'Azad Jammu and Kashmir'];

function Shell({ title, subtitle, children, wide }: { title: string; subtitle?: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-ink-50 px-4 py-10">
      <Link to="/" className="mb-6 flex items-center gap-2">
        <img src="/favicon.svg" alt="" className="h-8 w-8" />
        <span className="text-lg font-semibold">InvoiceGO</span>
      </Link>
      <div className={`card w-full ${wide ? 'max-w-2xl' : 'max-w-md'} p-6 sm:p-8`}>
        <h1 className="text-xl font-semibold text-ink-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-500">{subtitle}</p>}
        <div className="mt-6">{children}</div>
      </div>
    </div>
  );
}

export function Login() {
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const { setMe, me } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [resent, setResent] = useState(false);
  useEffect(() => {
    if (me) nav(sp.get('next') || '/app', { replace: true });
  }, [me, nav, sp]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const m = await api<Me>('/api/auth/login', { body: { email, password } });
      setMe(m);
      const next = sp.get('next');
      nav(next && next.startsWith('/app') ? next : '/app', { replace: true });
    } catch (e2) {
      setErr(e2);
    } finally {
      setBusy(false);
    }
  };
  const unverified = err instanceof ApiError && err.code === 'EMAIL_NOT_VERIFIED';
  return (
    <Shell title="Sign in" subtitle="Business account sign-in">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <ErrorBanner error={err} />
        {unverified && !resent && (
          <Button type="button" variant="secondary" onClick={async () => { await api('/api/auth/resend-verification', { body: { email } }); setResent(true); }}>
            Resend verification email
          </Button>
        )}
        {resent && <Alert tone="green">If the account is awaiting verification, a new link has been sent.</Alert>}
        <TextInput label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <TextInput label="Password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        <Button type="submit" loading={busy} className="w-full">
          Sign in
        </Button>
        <div className="flex justify-between text-sm">
          <Link to="/forgot-password" className="text-brand-700 hover:underline">
            Forgot password?
          </Link>
          <Link to="/register" className="text-brand-700 hover:underline">
            Create account
          </Link>
        </div>
      </form>
    </Shell>
  );
}

export function Register() {
  const [f, setF] = useState({ name: '', email: '', phone: '', password: '', confirm: '', businessName: '', ntnCnic: '', strn: '', address: '', province: 'Punjab', sector: 'All Other Sectors', retailerRegistered: false });
  const [acts, setActs] = useState<string[]>([]);
  const [err, setErr] = useState<unknown>(null);
  const [done, setDone] = useState<null | { emailSent: boolean; message: string }>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const issues = err instanceof ApiError ? err.issues : [];
  const localErr = f.confirm && f.confirm !== f.password ? 'Passwords do not match' : null;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (localErr) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ emailSent?: boolean; message: string }>('/api/auth/register', {
        body: {
          name: f.name,
          email: f.email,
          phone: f.phone,
          password: f.password,
          business: { name: f.businessName, ntnCnic: f.ntnCnic.trim(), strn: f.strn || null, address: f.address, province: f.province, businessActivities: acts, sector: f.sector, retailerRegistered: f.retailerRegistered },
        },
      });
      setDone({ emailSent: r.emailSent !== false, message: r.message });
    } catch (e2) {
      setErr(e2);
    } finally {
      setBusy(false);
    }
  };
  if (done)
    return (
      <Shell title={done.emailSent ? 'Check your email' : 'Account created'}>
        <Alert tone={done.emailSent ? 'green' : 'amber'} title="Account created">
          {done.emailSent ? <>We sent a verification link to {f.email}. Verify your email address, then sign in.</> : done.message}
        </Alert>
        <Link to="/login" className="mt-4 inline-block text-sm text-brand-700 hover:underline">
          Go to sign in
        </Link>
      </Shell>
    );
  return (
    <Shell title="Create your business account" subtitle="Fields marked * are required." wide>
      <form onSubmit={submit} className="space-y-5" noValidate>
        <ErrorBanner error={err} />
        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="col-span-full mb-1 text-sm font-semibold text-ink-800">Your details</legend>
          <TextInput label="Full name" required value={f.name} onChange={set('name')} autoComplete="name" error={issueFor(issues, 'name')} />
          <TextInput label="Phone number" required value={f.phone} onChange={set('phone')} autoComplete="tel" inputMode="tel" error={issueFor(issues, 'phone')} />
          <TextInput label="Email" type="email" required value={f.email} onChange={set('email')} autoComplete="email" className="sm:col-span-2" error={issueFor(issues, 'email')} />
          <TextInput label="Password" type="password" required value={f.password} onChange={set('password')} autoComplete="new-password" hint="At least 10 characters with letters and numbers" error={issueFor(issues, 'password')} />
          <TextInput label="Confirm password" type="password" required value={f.confirm} onChange={set('confirm')} autoComplete="new-password" error={localErr} />
        </fieldset>
        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="col-span-full mb-1 text-sm font-semibold text-ink-800">Business profile</legend>
          <TextInput label="Business name" required value={f.businessName} onChange={set('businessName')} className="sm:col-span-2" error={issueFor(issues, 'business.name')} />
          <TextInput label="NTN / CNIC" required value={f.ntnCnic} onChange={set('ntnCnic')} inputMode="numeric" hint="7-digit NTN or 13-digit CNIC, digits only" error={issueFor(issues, 'business.ntnCnic')} />
          <TextInput label="STRN" value={f.strn} onChange={set('strn')} hint="Sales tax registration number, if any" />
          <TextInput label="Business address" required value={f.address} onChange={set('address')} className="sm:col-span-2" error={issueFor(issues, 'business.address')} />
          <SelectInput label="Province" required value={f.province} onChange={set('province')} options={PROVINCES} />
          <SelectInput label="Sector" required value={f.sector} onChange={set('sector')} options={SECTORS} hint="Select one sector (IRIS: Sector — select one only)" />
          <div className="sm:col-span-2">
            <p className="mb-1 text-xs font-medium text-ink-700">
              Business nature<span className="text-red-600">*</span> <span className="font-normal text-ink-500">(select one or more)</span>
            </p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {ACTIVITIES.map((a) => (
                <Checkbox key={a} label={a} checked={acts.includes(a)} onChange={(v) => setActs(v ? [...acts, a] : acts.filter((x) => x !== a))} />
              ))}
            </div>
            {issueFor(issues, 'business.businessActivities') && <p className="mt-1 text-xs text-red-600">{issueFor(issues, 'business.businessActivities')}</p>}
          </div>
          <div className="sm:col-span-2">
            <Checkbox label="Registered as a retailer in my sales tax profile" hint="Required for scenarios SN026–SN028 (spec §9 note)." checked={f.retailerRegistered} onChange={(v) => setF({ ...f, retailerRegistered: v })} />
          </div>
        </fieldset>
        <Button type="submit" loading={busy} className="w-full" disabled={acts.length === 0}>
          Create account
        </Button>
        <p className="text-center text-sm text-ink-500">
          Already registered?{' '}
          <Link to="/login" className="text-brand-700 hover:underline">
            Sign in
          </Link>
        </p>
      </form>
    </Shell>
  );
}

export function VerifyEmail() {
  const [sp] = useSearchParams();
  const token = sp.get('token') ?? '';
  const ran = useRef(false);
  const q = useQuery({
    queryKey: ['verify', token],
    queryFn: async () => {
      if (ran.current) return true;
      ran.current = true;
      await api('/api/auth/verify-email', { body: { token } });
      return true;
    },
    retry: false,
    enabled: !!token,
  });
  return (
    <Shell title="Email verification">
      {q.isLoading && <p className="text-sm text-ink-500">Verifying…</p>}
      {q.isError && <ErrorBanner error={q.error} />}
      {q.isSuccess && <Alert tone="green" title="Your email is verified">You can now sign in.</Alert>}
      <Link to="/login" className="mt-4 inline-block text-sm text-brand-700 hover:underline">
        Go to sign in
      </Link>
    </Shell>
  );
}

export function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Shell title="Reset your password">
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setErr(null);
          try {
            const r = await api<{ message: string }>('/api/auth/forgot-password', { body: { email } });
            setMsg(r.message);
          } catch (e2) {
            setErr(e2);
          } finally {
            setBusy(false);
          }
        }}
      >
        <ErrorBanner error={err} />
        {msg && <Alert tone="green">{msg}</Alert>}
        <TextInput label="Email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <Button type="submit" loading={busy} className="w-full">
          Send reset link
        </Button>
        <Link to="/login" className="block text-center text-sm text-brand-700 hover:underline">
          Back to sign in
        </Link>
      </form>
    </Shell>
  );
}

export function ResetPassword() {
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState(false);
  return (
    <Shell title="Choose a new password">
      {ok ? (
        <>
          <Alert tone="green">Password updated. All other sessions were signed out.</Alert>
          <Button className="mt-4 w-full" onClick={() => nav('/login')}>
            Sign in
          </Button>
        </>
      ) : (
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (pw !== pw2) return;
            setBusy(true);
            setErr(null);
            try {
              await api('/api/auth/reset-password', { body: { token: sp.get('token') ?? '', password: pw } });
              setOk(true);
            } catch (e2) {
              setErr(e2);
            } finally {
              setBusy(false);
            }
          }}
        >
          <ErrorBanner error={err} />
          <TextInput label="New password" type="password" required value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" hint="At least 10 characters with letters and numbers" />
          <TextInput label="Confirm new password" type="password" required value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" error={pw2 && pw2 !== pw ? 'Passwords do not match' : null} />
          <Button type="submit" loading={busy} className="w-full">
            Update password
          </Button>
        </form>
      )}
    </Shell>
  );
}
