import { Link } from 'react-router-dom';
import { CalendarCheck, FileSpreadsheet, FlaskConical, Printer, ShieldCheck, UserCheck } from 'lucide-react';

const FEATURES = [
  { icon: FlaskConical, title: 'Sandbox scenarios, built in', body: 'Every supplied scenario (SN001–SN028) loads as an editable form and JSON. Run it against your own FBR sandbox token and track which required scenarios have genuinely passed.' },
  { icon: UserCheck, title: 'Buyer registration checks', body: 'Before anything is sent, the buyer’s registration type is checked with FBR. A wrong Registered/Unregistered choice is caught with the buyer’s name in the message.' },
  { icon: CalendarCheck, title: 'Current-month invoicing only', body: 'Invoices can only be created and submitted for the current calendar month (Pakistan time), enforced in the browser and on the server.' },
  { icon: FileSpreadsheet, title: 'Excel bulk upload', body: 'Upload 20 or more multi-item invoices at once, see row-level errors, validate them with FBR and submit only the ones you select.' },
  { icon: ShieldCheck, title: 'Careful submission', body: 'Exact decimal maths, item-level result checks, locked submissions and a reconciliation workflow when the outcome is uncertain — never a blind resend.' },
  { icon: Printer, title: 'A4 invoices with FBR number & QR', body: 'Printable invoices carry the FBR invoice number, the Digital Invoicing logo and QR only after FBR accepts them. Sandbox prints are clearly watermarked.' },
];

export default function Landing() {
  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-ink-100">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
          <Link to="/" className="flex items-center gap-2">
            <img src="/favicon.svg" alt="" className="h-8 w-8" />
            <span className="text-lg font-semibold">InvoiceGO</span>
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
          <div className="card self-center p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-ink-500">Invoice preview · sample</span>
              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800 ring-1 ring-amber-200">SANDBOX</span>
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
              {[
                ['HS code', '0101.2100'],
                ['Sale type', 'Goods at standard rate (default)'],
                ['Rate', '18%'],
                ['UOM', 'Numbers, pieces, units'],
                ['Value excl. ST', 'Rs 10,000.00'],
                ['Sales tax', 'Rs 1,800.00'],
              ].map(([k, v]) => (
                <div key={k} className="rounded-lg border border-ink-100 bg-ink-50 p-2.5">
                  <dt className="text-xs text-ink-500">{k}</dt>
                  <dd className="font-medium text-ink-900">{v}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-4 text-xs text-ink-500">Illustrative values. Every submission is checked at invoice and item level; HTTP 200 alone is never treated as success.</p>
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
      <footer className="border-t border-ink-100 py-6 text-center text-xs text-ink-500">© {new Date().getFullYear()} InvoiceGO · invoicego.com</footer>
    </div>
  );
}
