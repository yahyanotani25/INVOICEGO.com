import { Link } from 'react-router-dom';
import { CalendarCheck, FileSpreadsheet, FlaskConical, KeyRound, Printer, ShieldCheck, UserCheck, Users } from 'lucide-react';
import { BrandMark, useBranding } from '@/lib/branding';

const FEATURES = [
  { icon: FlaskConical, title: 'Sandbox scenarios, built in', body: 'Every supplied scenario (SN001–SN028) loads as an editable form and JSON. Run it against your own FBR sandbox token and track which required scenarios have genuinely passed.' },
  { icon: UserCheck, title: 'Buyer registration checks', body: 'Before anything is sent, the buyer’s registration type is checked with FBR. A wrong Registered/Unregistered choice is caught with the buyer’s name in the message.' },
  { icon: CalendarCheck, title: 'Current-month invoicing only', body: 'Invoices can only be created and submitted for the current calendar month (Pakistan time), enforced in the browser and on the server.' },
  { icon: FileSpreadsheet, title: 'Excel bulk upload', body: 'Upload 20 or more multi-item invoices at once, see row-level errors, validate them with FBR and submit only the ones you select.' },
  { icon: ShieldCheck, title: 'Careful submission', body: 'Exact decimal maths, item-level result checks, locked submissions and a reconciliation workflow when the outcome is uncertain — never a blind resend.' },
  { icon: Printer, title: 'A4 invoices with FBR number & QR', body: 'Printable invoices carry the FBR invoice number, the Digital Invoicing logo and QR only after FBR accepts them. Sandbox prints are clearly watermarked.' },
  { icon: Users, title: 'Your whole team, with roles', body: 'Invite accountants and operators by email. Owners and admins manage FBR credentials; viewers get read-only access.' },
  { icon: KeyRound, title: 'Secure accounts', body: 'Optional two-factor sign-in with recovery codes, encrypted FBR tokens that never reach the browser, and a full audit trail.' },
];

const STEPS = [
  { title: 'Create your account', body: 'Register your business with the NTN/CNIC, business nature and sector exactly as they appear in IRIS.' },
  { title: 'Connect IRIS', body: 'Complete the technical details and IP whitelisting in IRIS, then save your sandbox token in InvoiceGO.' },
  { title: 'Pass the sandbox scenarios', body: 'Run the scenarios that apply to your business. Each is marked passed only after FBR accepts it.' },
  { title: 'Go live', body: 'Save the production token IRIS issues, then create, validate and submit real invoices.' },
];

export default function Landing() {
  const brand = useBranding();
  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-ink-100">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
          <Link to="/" className="flex items-center gap-2">
            <BrandMark size="lg" />
          </Link>
          <nav className="flex items-center gap-2">
            <Link to="/login" className="rounded-lg px-3 py-2 text-sm font-medium text-ink-700 hover:bg-ink-100">
              Sign in
            </Link>
            <Link to="/register" className="rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-700">
              Create account
            </Link>
          </nav>
        </div>
      </header>
      <main>
        <section className="mx-auto grid max-w-6xl gap-10 px-4 py-16 lg:grid-cols-2 lg:py-24">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-brand-600">FBR Digital Invoicing · DI API v1.12</p>
            <h1 className="mt-3 text-4xl font-semibold leading-tight tracking-tight text-ink-900 sm:text-5xl">
              Sales tax invoices for Pakistani businesses, <span className="text-brand-600">validated before you submit.</span>
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-ink-600">
              InvoiceGO helps you build FBR Digital Invoicing invoices with the right sale type, rate, UOM and SRO, validate them with FBR using your own token, submit them, and print a clean A4 invoice.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/register" className="rounded-lg bg-brand-600 px-5 py-3 text-sm font-semibold text-white shadow-sm hover:bg-brand-700">
                Create your account
              </Link>
              <Link to="/login" className="rounded-lg border border-ink-200 px-5 py-3 text-sm font-semibold text-ink-800 hover:bg-ink-50">
                Sign in
              </Link>
            </div>
          </div>
          <div className="card self-center p-6">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">From sign-up to live invoicing</h2>
            <ol className="mt-4 space-y-4">
              {STEPS.map((st, i) => (
                <li key={st.title} className="flex gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-50 text-sm font-semibold text-brand-700 ring-1 ring-brand-200">{i + 1}</span>
                  <div>
                    <p className="font-medium text-ink-900">{st.title}</p>
                    <p className="mt-0.5 text-sm leading-relaxed text-ink-600">{st.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>
        <section className="border-t border-ink-100 bg-ink-50 py-16">
          <div className="mx-auto max-w-6xl px-4">
            <h2 className="text-2xl font-semibold tracking-tight">What InvoiceGO does</h2>
            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((f) => (
                <div key={f.title} className="card p-5">
                  <f.icon className="h-6 w-6 text-brand-600" aria-hidden />
                  <h3 className="mt-3 font-semibold text-ink-900">{f.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-ink-600">{f.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
        <section className="mx-auto max-w-6xl px-4 py-12">
          <div className="card p-6 text-sm leading-relaxed text-ink-600">
            <h2 className="text-base font-semibold text-ink-900">How access to FBR works</h2>
            <p className="mt-2">
              FBR Digital Invoicing credentials are issued to each taxpayer through IRIS (Digital Invoicing → API Integration). You complete technical details and IP whitelisting there, use your sandbox token to pass the scenarios that apply to your business, and IRIS then provides your production token. InvoiceGO stores your tokens encrypted on the server and never shows them in full.
            </p>
            <p className="mt-2 text-xs text-ink-500">InvoiceGO is independent software. It is not FBR-certified, FBR-approved or an FBR-licensed integrator.</p>
          </div>
        </section>
      </main>
      <footer className="border-t border-ink-100 py-6 text-center text-xs text-ink-500">
        <p>© {new Date().getFullYear()} {brand.companyName ?? brand.softwareName}{brand.companyAddress ? ` · ${brand.companyAddress}` : ''}</p>
        {(brand.supportEmail || brand.supportPhone) && (
          <p className="mt-1">
            Support: {brand.supportEmail && <a className="text-brand-700 hover:underline" href={`mailto:${brand.supportEmail}`}>{brand.supportEmail}</a>}
            {brand.supportEmail && brand.supportPhone && ' · '}
            {brand.supportPhone}
          </p>
        )}
      </footer>
    </div>
  );
}
