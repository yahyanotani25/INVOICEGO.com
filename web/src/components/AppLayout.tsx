import { useState, type ReactNode } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { Bell, BookOpen, Boxes, ClipboardCheck, FileSpreadsheet, FilePlus2, FileText, FlaskConical, Hash, LayoutDashboard, LifeBuoy, LogOut, Menu, PlugZap, Settings as SettingsIcon, Users, BarChart3, AlertOctagon, X } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { Badge } from './ui';

const NAV = [
  { section: 'Workspace', items: [
    { to: '/app', label: 'Dashboard', icon: LayoutDashboard, end: true },
    { to: '/app/invoices/new', label: 'Create invoice', icon: FilePlus2 },
    { to: '/app/invoices', label: 'Invoices', icon: FileText, end: true },
    { to: '/app/bulk', label: 'Excel bulk upload', icon: FileSpreadsheet },
    { to: '/app/customers', label: 'Customers', icon: Users },
    { to: '/app/products', label: 'Products', icon: Boxes },
    { to: '/app/hs-codes', label: 'HS / PCT codes', icon: Hash },
    { to: '/app/reports', label: 'Reports', icon: BarChart3 },
  ] },
  { section: 'FBR', items: [
    { to: '/app/sandbox', label: 'Sandbox scenarios', icon: FlaskConical },
    { to: '/app/fbr', label: 'FBR integration', icon: PlugZap },
    { to: '/app/onboarding', label: 'Onboarding checklist', icon: ClipboardCheck },
    { to: '/app/error-codes', label: 'FBR error codes', icon: AlertOctagon },
  ] },
  { section: 'Account', items: [
    { to: '/app/support', label: 'Help & support', icon: LifeBuoy },
    { to: '/app/settings', label: 'Settings', icon: SettingsIcon },
  ] },
];

export default function AppLayout({ children }: { children: ReactNode }) {
  const { me, logout, setMe } = useAuth();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const notif = useQuery({ queryKey: ['notifications'], queryFn: () => api<{ unread: number; announcements: { id: string; kind: string; title: string; body: string }[] }>('/api/app/notifications'), refetchInterval: 60_000 });
  const b = me?.business;

  const sidebar = (
    <nav aria-label="Main" className="flex h-full flex-col gap-4 overflow-y-auto px-3 py-4">
      <Link to="/app" className="flex items-center gap-2 px-2" onClick={() => setOpen(false)}>
        <img src="/favicon.svg" alt="" className="h-7 w-7" />
        <span className="text-lg font-semibold tracking-tight text-ink-900">InvoiceGO</span>
      </Link>
      {b && (
        <div className="rounded-xl border border-ink-200 bg-ink-50 p-3">
          <p className="truncate text-sm font-semibold text-ink-900" title={b.name}>
            {b.name}
          </p>
          <p className="text-xs text-ink-500">NTN/CNIC {b.ntnCnic} · {b.role.toLowerCase()}</p>
          <div className="mt-2 flex flex-wrap gap-1">
            {b.productionEnabled ? <Badge tone="green">Production enabled</Badge> : <Badge tone="amber">Sandbox only</Badge>}
          </div>
          {me && me.businesses.length > 1 && (
            <select
              aria-label="Switch business"
              className="input mt-2 py-1 text-xs"
              value={b.id}
              onChange={async (e) => {
                const m = await api<never>('/api/auth/switch-business', { body: { businessId: e.target.value } });
                setMe(m);
                nav('/app');
              }}
            >
              {me.businesses.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          )}
        </div>
      )}
      {NAV.map((s) => (
        <div key={s.section}>
          <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-ink-400">{s.section}</p>
          <ul className="space-y-0.5">
            {s.items.map((it) => (
              <li key={it.to}>
                <NavLink
                  to={it.to}
                  end={it.end}
                  onClick={() => setOpen(false)}
                  className={({ isActive }) => clsx('flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm', isActive ? 'bg-brand-50 font-medium text-brand-700' : 'text-ink-700 hover:bg-ink-100')}
                >
                  <it.icon className="h-4 w-4" aria-hidden />
                  {it.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <div className="mt-auto px-2 text-[11px] leading-relaxed text-ink-400">
        <BookOpen className="mr-1 inline h-3 w-3" aria-hidden />
        Implements PRAL DI API spec v1.12. InvoiceGO is not an FBR-certified or FBR-approved product.
      </div>
    </nav>
  );

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[260px_1fr]">
      <aside className="no-print sticky top-0 hidden h-screen border-r border-ink-200 bg-white lg:block">{sidebar}</aside>
      {open && (
        <div className="no-print fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-ink-900/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 bg-white shadow-xl">
            <button className="absolute right-2 top-2 rounded p-2 text-ink-500" onClick={() => setOpen(false)} aria-label="Close menu">
              <X className="h-5 w-5" />
            </button>
            {sidebar}
          </aside>
        </div>
      )}
      <div className="min-w-0">
        <header className="no-print sticky top-0 z-30 flex items-center justify-between gap-2 border-b border-ink-200 bg-white/90 px-4 py-2.5 backdrop-blur">
          <button className="rounded p-2 text-ink-600 lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </button>
          <div className="hidden text-xs text-ink-500 sm:block">Times shown in Pakistan Standard Time (Asia/Karachi)</div>
          <div className="flex items-center gap-2">
            <Link to="/app/notifications" className="relative rounded-lg p-2 text-ink-600 hover:bg-ink-100" aria-label={`Notifications${notif.data?.unread ? `, ${notif.data.unread} unread` : ''}`}>
              <Bell className="h-5 w-5" />
              {!!notif.data?.unread && <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-red-500" />}
            </Link>
            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium text-ink-900">{me?.user.name}</p>
              <p className="text-xs text-ink-500">{me?.user.email}</p>
            </div>
            <button
              onClick={async () => {
                await logout();
                nav('/login');
              }}
              className="rounded-lg p-2 text-ink-600 hover:bg-ink-100"
              aria-label="Sign out"
              title="Sign out"
            >
              <LogOut className="h-5 w-5" />
            </button>
          </div>
        </header>
        {notif.data?.announcements?.map((a) => (
          <div key={a.id} className={clsx('no-print border-b px-4 py-2 text-sm', a.kind === 'MAINTENANCE' ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-sky-200 bg-sky-50 text-sky-900')}>
            <strong>{a.kind === 'MAINTENANCE' ? 'Maintenance: ' : ''}{a.title}</strong> — {a.body}
          </div>
        ))}
        <main className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6">{children}</main>
      </div>
    </div>
  );
}
