import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { CalendarCheck, Lock, ShieldCheck } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError, setCsrf } from '@/lib/api';
import { useAuth, type Me, type MfaPending } from '@/lib/auth';
import { BrandMark } from '@/lib/branding';
import { Alert, Button, Checkbox, ErrorBanner, SelectInput, TextInput, issueFor } from '@/components/ui';

export const ACTIVITIES = ['Manufacturer', 'Importer', 'Distributor', 'Wholesaler', 'Exporter', 'Retailer', 'Service Provider', 'Other'];
export const SECTORS = ['All Other Sectors', 'Steel', 'FMCG', 'Textile', 'Telecom', 'Petroleum', 'Electricity Distribution', 'Gas Distribution', 'Services', 'Automobile', 'CNG Stations', 'Pharmaceuticals', 'Wholesale / Retails'];
export const PROVINCES = ['Punjab', 'Sindh', 'Khyber Pakhtunkhwa', 'Balochistan', 'Capital Territory', 'Gilgit Baltistan', 'Azad Jammu and Kashmir'];

const SHELL_POINTS = [
  { icon: ShieldCheck, text: 'Every invoice is checked with FBR before it is submitted' },
  { icon: CalendarCheck, text: 'Current-month rule and buyer registration checks built in' },
  { icon: Lock, text: 'FBR tokens are encrypted and never reach the browser' },
];

function Shell({ title, subtitle, children, wide }: { title: string; subtitle?: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <aside className="relative hidden overflow-hidden bg-gradient-to-br from-navy via-brand-800 to-brand-600 p-10 text-white lg:flex lg:flex-col lg:justify-between">
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="absolute -right-20 -top-20 h-80 w-80 animate-blob rounded-full bg-white/10 blur-3xl" />
          <div className="absolute -bottom-24 left-10 h-72 w-72 animate-blob rounded-full bg-sky-300/20 blur-3xl [animation-delay:-6s]" />
        </div>
        <Link to="/" className="relative flex items-center gap-2 [&_span]:!text-white">
          <BrandMark size="lg" />
        </Link>
        <div className="relative animate-fade-up">
          <h2 className="text-3xl font-semibold leading-tight tracking-tight">FBR Digital Invoicing,<br />done carefully.</h2>
          <ul className="mt-8 space-y-4">
            {SHELL_POINTS.map((p, i) => (
              <li key={p.text} className="flex animate-fade-up items-start gap-3 text-sm text-white/90" style={{ animationDelay: `${150 + i * 90}ms` }}>
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/15 ring-1 ring-white/20"><p.icon className="h-4 w-4" aria-hidden /></span>
                <span className="pt-1.5">{p.text}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-white/60">InvoiceGO is independent software. It is not FBR-certified or FBR-approved.</p>
      </aside>
      <div className="flex flex-col items-center justify-center px-4 py-10">
        <Link to="/" className="mb-6 flex items-center gap-2 lg:hidden">
          <BrandMark size="lg" />
        </Link>
        <div className={`card w-full animate-dialog-in ${wide ? 'max-w-2xl' : 'max-w-md'} p-6 shadow-lift sm:p-8`}>
          <h1 className="text-xl font-semibold text-ink-900">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-ink-500">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </div>
      </div>
    </div>
  );
}

/** Only same-app paths under /app are allowed as a post-login destination (no open redirects). */
function safeNext(next: string | null): string {
  if (!next || !/^\/app(?:[/?#]|$)/.test(next)) return '/app';
  if (next.includes('\\') || next.includes('//') || next.includes('..')) return '/app';
  return next;
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
  const [mfaStep, setMfaStep] = useState(false);
  const [code, setCode] = useState('');
  useEffect(() => {
    if (me) nav(safeNext(sp.get('next')), { replace: true });
  }, [me, nav, sp]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const m = await api<Me | MfaPending>('/api/auth/login', { body: { email, password } });
      if ('mfaRequired' in m) {
        setCsrf('app', m.csrfToken);
        setMfaStep(true);
        return;
      }
      setMe(m);
      nav(safeNext(sp.get('next')), { replace: true });
    } catch (e2) {
      setErr(e2);
    } finally {
      setBusy(false);
    }
  };
  const verify = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const m = await api<Me>('/api/auth/mfa/verify', { body: { code: code.trim() } });
      setMe(m);
      nav(safeNext(sp.get('next')), { replace: true });
    } catch (e2) {
      setErr(e2);
      // The sign-in ended (too many wrong codes or expired): start again from the password.
      if (e2 instanceof ApiError && (e2.status === 429 || e2.code === 'UNAUTHORIZED')) {
        setMfaStep(false);
        setCode('');
        setPassword('');
      }
    } finally {
      setBusy(false);
    }
  };
  const unverified = err instanceof ApiError && err.code === 'EMAIL_NOT_VERIFIED';
  if (mfaStep) {
    return (
      <Shell title="Two-factor authentication" subtitle="Enter the 6-digit code from your authenticator app.">
        <form onSubmit={verify} className="space-y-4" noValidate>
          <ErrorBanner error={err} />
          <TextInput label="Authentication code" autoComplete="one-time-code" inputMode="text" autoFocus required value={code} onChange={(e) => setCode(e.target.value)} hint="Lost your phone? Enter one of your recovery codes instead (for example abcde-fghjk)." />
          <Button type="submit" loading={busy} className="w-full" disabled={code.trim().length < 6}>
            Verify and sign in
          </Button>
          <button type="button" className="w-full text-center text-sm text-brand-700 hover:underline" onClick={() => { setMfaStep(false); setCode(''); setErr(null); }}>
            Use a different account
          </button>
        </form>
      </Shell>
    );
  }
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

interface InviteInfo { businessName: string; email: string; role: string; roleDescription: string; invitedBy: string | null; expiresAt: string; accountExists: boolean }

/** Accepting a team invitation: new people create their account here; existing users confirm with their password. */
export function AcceptInvite() {
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const token = sp.get('token') ?? '';
  const { setMe } = useAuth();
  const info = useQuery({ queryKey: ['team-invite', token], queryFn: () => api<InviteInfo>(`/api/auth/team-invite?token=${encodeURIComponent(token)}`), enabled: token.length > 20, retry: false });
  const [f, setF] = useState({ name: '', phone: '', password: '', confirm: '' });
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [mfaStep, setMfaStep] = useState(false);
  const [code, setCode] = useState('');
  const issues = err instanceof ApiError ? err.issues : [];
  if (!token) return <Shell title="Team invitation"><Alert tone="red">This invitation link is incomplete. Open the link from your email again.</Alert></Shell>;
  if (info.isLoading) return <Shell title="Team invitation"><p className="text-sm text-ink-500">Checking the invitation…</p></Shell>;
  if (info.error || !info.data) {
    return (
      <Shell title="Team invitation">
        <ErrorBanner error={info.error} />
        <p className="mt-4 text-sm text-ink-600">Already a member? <Link to="/login" className="text-brand-700 hover:underline">Sign in</Link>.</p>
      </Shell>
    );
  }
  const inv = info.data;
  const isNew = !inv.accountExists;
  const mismatch = isNew && f.confirm && f.confirm !== f.password ? 'Passwords do not match' : null;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (mismatch) return;
    setBusy(true);
    setErr(null);
    try {
      const m = await api<Me | MfaPending>('/api/auth/team-invite/accept', { body: isNew ? { token, name: f.name, phone: f.phone, password: f.password } : { token, password: f.password } });
      if ('mfaRequired' in m) {
        setCsrf('app', m.csrfToken);
        setMfaStep(true);
        return;
      }
      setMe(m);
      nav('/app', { replace: true });
    } catch (e2) {
      setErr(e2);
    } finally {
      setBusy(false);
    }
  };
  const verify = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      setMe(await api<Me>('/api/auth/mfa/verify', { body: { code: code.trim() } }));
      nav('/app', { replace: true });
    } catch (e2) {
      setErr(e2);
    } finally {
      setBusy(false);
    }
  };
  if (mfaStep) {
    return (
      <Shell title="Two-factor authentication" subtitle={`You joined ${inv.businessName}. Enter your code to finish signing in.`}>
        <form onSubmit={verify} className="space-y-4" noValidate>
          <ErrorBanner error={err} />
          <TextInput label="Authentication code" autoComplete="one-time-code" autoFocus required value={code} onChange={(e) => setCode(e.target.value)} hint="Or one of your recovery codes" />
          <Button type="submit" loading={busy} className="w-full" disabled={code.trim().length < 6}>Verify and continue</Button>
        </form>
      </Shell>
    );
  }
  return (
    <Shell title={`Join ${inv.businessName}`} subtitle={<>{inv.invitedBy ? `${inv.invitedBy} invited you` : 'You have been invited'} to InvoiceGO as <strong>{inv.role.toLowerCase()}</strong>.</>}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Alert tone="blue">{inv.roleDescription}.</Alert>
        <ErrorBanner error={err} />
        <TextInput label="Email" value={inv.email} disabled hint="The invitation is for this address" />
        {isNew ? (
          <>
            <TextInput label="Your full name" required autoComplete="name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} error={issueFor(issues, 'name')} />
            <TextInput label="Phone number" required autoComplete="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} error={issueFor(issues, 'phone')} />
            <TextInput label="Choose a password" type="password" required autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} error={issueFor(issues, 'password')} hint="At least 10 characters with letters and numbers" />
            <TextInput label="Confirm password" type="password" required autoComplete="new-password" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} error={mismatch} />
          </>
        ) : (
          <TextInput label="Your InvoiceGO password" type="password" required autoComplete="current-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} hint={<>You already have an account. <Link to="/forgot-password" className="text-brand-700 hover:underline">Forgot your password?</Link></>} />
        )}
        <Button type="submit" loading={busy} className="w-full" disabled={!f.password || (isNew && (!f.name || !f.phone || !!mismatch || !f.confirm))}>
          {isNew ? 'Create account and join' : 'Join business'}
        </Button>
        <p className="text-center text-xs text-ink-500">This invitation expires on {new Date(inv.expiresAt).toLocaleDateString('en-PK', { day: '2-digit', month: 'short', year: 'numeric' })}.</p>
      </form>
    </Shell>
  );
}
