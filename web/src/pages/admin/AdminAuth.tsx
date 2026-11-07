import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { api, ApiError, setCsrf } from '@/lib/api';
import { useAdminMe } from '@/lib/auth';
import { Alert, Button, ErrorBanner, Spinner, TextInput, issueFor } from '@/components/ui';

function Shell({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-navy px-4 py-10">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl sm:p-8">
        <div className="mb-6 flex items-center gap-2">
          <img src="/favicon.svg" alt="" className="h-8 w-8" />
          <div>
            <p className="text-lg font-semibold text-ink-900">
              InvoiceGO <span className="font-normal text-brand-600">Admin</span>
            </p>
            <p className="text-xs text-ink-500">Restricted area — all access is audited</p>
          </div>
        </div>
        <h1 className="text-xl font-semibold text-ink-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-500">{subtitle}</p>}
        <div className="mt-5">{children}</div>
      </div>
    </div>
  );
}

type Step = 'password' | 'enroll' | 'verify';

export function AdminLogin() {
  const me = useAdminMe();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [step, setStep] = useState<Step>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [setup, setSetup] = useState<{ qrDataUrl: string; secret: string } | null>(null);
  const setupStarted = useRef(false);

  // Resume a session that passed the password step but not MFA.
  useEffect(() => {
    if (!me.data) return;
    if (me.data.mfaVerified) nav('/admin', { replace: true });
    else setStep(me.data.needsEnrollment ? 'enroll' : 'verify');
  }, [me.data, nav]);

  useEffect(() => {
    if (step !== 'enroll' || setupStarted.current) return;
    setupStarted.current = true;
    api<{ qrDataUrl: string; secret: string }>('/api/admin/auth/totp/setup', { method: 'POST', body: {}, area: 'admin' })
      .then(setSetup)
      .catch((e) => {
        if (e instanceof ApiError && /already enrolled/i.test(e.message)) setStep('verify');
        else setError(e);
      });
  }, [step]);

  const finish = async () => {
    await qc.invalidateQueries({ queryKey: ['admin-me'] });
    nav('/admin', { replace: true });
  };

  const submitPassword = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ csrfToken: string; mfa: 'ENROLL' | 'VERIFY' }>('/api/admin/auth/login', { body: { email, password }, area: 'admin' });
      setCsrf('admin', r.csrfToken);
      setPassword('');
      setStep(r.mfa === 'ENROLL' ? 'enroll' : 'verify');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const submitCode = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(step === 'enroll' ? '/api/admin/auth/totp/enable' : '/api/admin/auth/totp/verify', { body: { code }, area: 'admin' });
      await finish();
    } catch (err) {
      setError(err);
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  if (me.isLoading) return <Spinner />;

  if (step === 'password') {
    return (
      <Shell title="Administrator sign in" subtitle="Two-factor authentication is required for every administrator.">
        <form onSubmit={submitPassword} className="space-y-4" noValidate>
          {!!error && <ErrorBanner error={error} />}
          <TextInput label="Email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <TextInput label="Password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          <Button type="submit" className="w-full" loading={busy} disabled={!email || !password}>
            Continue
          </Button>
          <p className="text-center text-xs text-ink-500">
            Administrator accounts are created by invitation only. <Link to="/" className="text-brand-700 underline">Back to InvoiceGO</Link>
          </p>
          <BootstrapHint />
        </form>
      </Shell>
    );
  }

  return (
    <Shell
      title={step === 'enroll' ? 'Set up two-factor authentication' : 'Enter your authentication code'}
      subtitle={step === 'enroll' ? 'Scan the QR code with an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…), then enter the 6-digit code.' : 'Open your authenticator app and enter the current 6-digit code for InvoiceGO Admin.'}
    >
      <form onSubmit={submitCode} className="space-y-4" noValidate>
        {!!error && <ErrorBanner error={error} />}
        {step === 'enroll' &&
          (setup ? (
            <div className="flex flex-col items-center gap-2 rounded-xl border border-ink-200 p-4">
              <img src={setup.qrDataUrl} alt="QR code for your authenticator app" className="h-48 w-48" />
              <p className="text-xs text-ink-500">Can’t scan? Enter this key manually:</p>
              <code className="break-all rounded bg-ink-100 px-2 py-1 font-mono text-xs text-ink-800">{setup.secret}</code>
            </div>
          ) : (
            !error && <Spinner label="Generating secret…" />
          ))}
        <TextInput
          label="6-digit code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          maxLength={6}
          required
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          error={error instanceof ApiError ? issueFor(error.issues, 'code') : null}
        />
        <Button type="submit" className="w-full" loading={busy} disabled={code.length !== 6 || (step === 'enroll' && !setup)}>
          <ShieldCheck className="h-4 w-4" /> {step === 'enroll' ? 'Enable and continue' : 'Verify'}
        </Button>
        <button
          type="button"
          className="w-full text-center text-xs text-ink-500 underline"
          onClick={async () => {
            try {
              await api('/api/admin/auth/logout', { method: 'POST', body: {}, area: 'admin' });
            } catch {
              /* ignore */
            }
            setCsrf('admin', null);
            qc.setQueryData(['admin-me'], null);
            setupStarted.current = false;
            setSetup(null);
            setStep('password');
          }}
        >
          Use a different account
        </button>
      </form>
    </Shell>
  );
}

export function AcceptInvite() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState(false);

  const mismatch = confirm.length > 0 && confirm !== password;
  const tooShort = password.length > 0 && password.length < 12;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (mismatch || tooShort) return;
    setBusy(true);
    setError(null);
    try {
      await api('/api/admin/auth/accept-invite', { body: { token, name, password }, area: 'admin' });
      setDone(true);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  if (!token) {
    return (
      <Shell title="Invitation link required">
        <Alert tone="red">This page needs the one-time invitation link sent to you. Ask a SUPER_ADMIN to issue a new invitation.</Alert>
      </Shell>
    );
  }
  if (done) {
    return (
      <Shell title="Password set">
        <Alert tone="green">Your administrator password is set. Sign in now — you will be asked to enrol two-factor authentication.</Alert>
        <Link to="/admin/login" className="mt-4 inline-flex w-full items-center justify-center rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-700">
          Go to administrator sign in
        </Link>
      </Shell>
    );
  }
  const issues = error instanceof ApiError ? error.issues : [];
  return (
    <Shell title="Accept administrator invitation" subtitle="Choose a strong password (at least 12 characters, letters and numbers). The link is valid for 24 hours and can be used once.">
      <form onSubmit={submit} className="space-y-4" noValidate>
        {!!error && <ErrorBanner error={error} />}
        <TextInput label="Your name" required autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} error={issueFor(issues, 'name')} />
        <TextInput label="Password" type="password" required autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} error={tooShort ? 'At least 12 characters' : issueFor(issues, 'password')} />
        <TextInput label="Confirm password" type="password" required autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} error={mismatch ? 'Passwords do not match' : null} />
        <Button type="submit" className="w-full" loading={busy} disabled={!name || !password || mismatch || tooShort}>
          Set password
        </Button>
      </form>
    </Shell>
  );
}

function useBootstrapStatus() {
  return useQuery({
    queryKey: ['admin-bootstrap-status'],
    queryFn: () => api<{ available: boolean; email: string | null }>('/api/admin/auth/bootstrap-status', { area: 'admin' }),
    retry: false,
    staleTime: 30_000,
  });
}

function BootstrapHint() {
  const q = useBootstrapStatus();
  if (!q.data?.available) return null;
  return (
    <Alert tone="amber">
      No administrator exists yet. <Link to="/admin/setup" className="font-medium underline">Set up the first administrator</Link> with the server setup token.
    </Alert>
  );
}

/**
 * First-administrator setup for hosts without shell access. Only works while the server has
 * ADMIN_BOOTSTRAP_TOKEN configured and no active SUPER_ADMIN exists.
 */
export function AdminSetup() {
  const status = useBootstrapStatus();
  const [token, setToken] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState<string | null>(null);
  const mismatch = confirm.length > 0 && confirm !== password;
  const tooShort = password.length > 0 && password.length < 12;

  if (status.isLoading) return <Spinner />;
  if (done) {
    return (
      <Shell title="Administrator created">
        <Alert tone="green">{done}</Alert>
        <Link to="/admin/login" className="mt-4 inline-flex w-full items-center justify-center rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-700">
          Go to administrator sign in
        </Link>
      </Shell>
    );
  }
  if (!status.data?.available) {
    return (
      <Shell title="Setup not available">
        <Alert tone="blue">Administrator setup is closed: an administrator already exists, or the server has no setup token configured. Use an invitation instead.</Alert>
        <Link to="/admin/login" className="mt-4 inline-block text-sm text-brand-700 underline">Administrator sign in</Link>
      </Shell>
    );
  }
  const issues = error instanceof ApiError ? error.issues : [];
  return (
    <Shell title="Set up the first administrator" subtitle={`Creates the administrator account for ${status.data.email}. Two-factor authentication is enrolled at first sign-in.`}>
      <form
        className="space-y-4"
        noValidate
        onSubmit={async (e: FormEvent) => {
          e.preventDefault();
          if (mismatch || tooShort) return;
          setBusy(true);
          setError(null);
          try {
            const r = await api<{ message: string }>('/api/admin/auth/bootstrap', { body: { token, name, password }, area: 'admin' });
            setDone(r.message);
          } catch (err) {
            setError(err);
          } finally {
            setBusy(false);
          }
        }}
      >
        {!!error && <ErrorBanner error={error} />}
        <TextInput label="Server setup token" type="password" autoComplete="off" required value={token} onChange={(e) => setToken(e.target.value)} hint="The ADMIN_BOOTSTRAP_TOKEN value configured on the server" />
        <TextInput label="Administrator email" value={status.data.email ?? ''} disabled />
        <TextInput label="Your name" required autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} error={issueFor(issues, 'name')} />
        <TextInput label="Password" type="password" required autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} error={tooShort ? 'At least 12 characters' : issueFor(issues, 'password')} />
        <TextInput label="Confirm password" type="password" required autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} error={mismatch ? 'Passwords do not match' : null} />
        <Button type="submit" className="w-full" loading={busy} disabled={!token || !name || !password || mismatch || tooShort}>
          Create administrator
        </Button>
      </form>
    </Shell>
  );
}
