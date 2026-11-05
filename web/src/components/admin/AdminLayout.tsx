import { useState, type ReactNode } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Bell, DatabaseBackup, FileText, Gauge, LifeBuoy, LogOut, Menu, PlugZap, Settings, ShieldCheck, Users, BarChart3, Megaphone, X } from 'lucide-react';
import { setCsrf } from '@/lib/api';
import type { AdminMe } from '@/lib/auth';
import { Badge } from '@/components/ui';
import { aapi } from './adminApi';

const NAV: { to: string; label: string; icon: typeof Gauge; perm?: string; end?: boolean }[] = [
  { to: '/admin', label: 'Dashboard', icon: Gauge, end: true },
  { to: '/admin/users', label: 'Users', icon: Users, perm: 'users.read' },
  { to: '/admin/invoices', label: 'Invoice oversight', icon: FileText, perm: 'invoices.read' },
  { to: '/admin/fbr', label: 'FBR / PRAL monitoring', icon: PlugZap, perm: 'fbr.read' },
  { to: '/admin/reports', label: 'Reports', icon: BarChart3, perm: 'reports.read' },
  { to: '/admin/support', label: 'Support', icon: LifeBuoy, perm: 'support.read' },
  { to: '/admin/notifications', label: 'Notifications', icon: Megaphone },
  { to: '/admin/settings', label: 'System settings', icon: Settings, perm: 'settings.read' },
  { to: '/admin/security', label: 'Security', icon: ShieldCheck, perm: 'security.read' },
  { to: '/admin/backups', label: 'Backups', icon: DatabaseBackup, perm: 'settings.read' },
];

export default function AdminLayout({ me, children }: { me: AdminMe; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  const qc = useQueryClient();
  const notif = useQuery({ queryKey: ['admin-notifications'], queryFn: () => aapi<{ unread: number }>('/notifications'), refetchInterval: 60_000 });
  const items = NAV.filter((n) => !n.perm || me.permissions.includes(n.perm));

  const signOut = async () => {
    try {
      await aapi('/auth/logout', { method: 'POST', body: {} });
    } finally {
      setCsrf('admin', null);
      qc.removeQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('admin') });
      qc.setQueryData(['admin-me'], null);
      nav('/admin/login');
    }
  };

  const sidebar = (
    <nav aria-label="Administrator" className="flex h-full flex-col gap-4 overflow-y-auto px-3 py-4 text-ink-100">
      <Link to="/admin" className="flex items-center gap-2 px-2" onClick={() => setOpen(false)}>
        <img src="/favicon.svg" alt="" className="h-7 w-7" />
        <span className="text-lg font-semibold tracking-tight text-white">
          InvoiceGO <span className="font-normal text-brand-200">Admin</span>
        </span>
      </Link>
      <div className="rounded-xl bg-white/5 p-3 ring-1 ring-white/10">
        <p className="truncate text-sm font-medium text-white">{me.user.name}</p>
        <p className="truncate text-xs text-ink-300">{me.user.email}</p>
        <Badge tone="violet" className="mt-2">
          {me.role.replace('_', ' ')}
        </Badge>
      </div>
      <ul className="space-y-0.5">
        {items.map((it) => (
          <li key={it.to}>
            <NavLink
              to={it.to}
              end={it.end}
              onClick={() => setOpen(false)}
              className={({ isActive }) => clsx('flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm', isActive ? 'bg-white/15 font-medium text-white' : 'text-ink-200 hover:bg-white/10 hover:text-white')}
            >
              <it.icon className="h-4 w-4" aria-hidden />
              {it.label}
            </NavLink>
          </li>
        ))}
      </ul>
      <p className="mt-auto px-2 text-[11px] leading-relaxed text-ink-400">Administrator actions and access to business records are audited. Subscriptions and payments are deferred in this release.</p>
    </nav>
  );

  return (
    <div className="min-h-screen bg-ink-50 lg:grid lg:grid-cols-[260px_1fr]">
      <aside className="sticky top-0 hidden h-screen bg-navy lg:block">{sidebar}</aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-ink-900/50" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 bg-navy shadow-xl">
            <button className="absolute right-2 top-2 rounded p-2 text-ink-200" onClick={() => setOpen(false)} aria-label="Close menu">
              <X className="h-5 w-5" />
            </button>
            {sidebar}
          </aside>
        </div>
      )}
      <div className="min-w-0">
        <header className="sticky top-0 z-30 flex items-center justify-between gap-2 border-b border-ink-200 bg-white/90 px-4 py-2.5 backdrop-blur">
          <div className="flex items-center gap-2">
            <button className="rounded p-2 text-ink-600 lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu">
              <Menu className="h-5 w-5" />
            </button>
            <Badge tone="violet" className="font-semibold">
              ADMIN CONSOLE
            </Badge>
            <span className="hidden text-xs text-ink-500 sm:inline">Times in Pakistan Standard Time (Asia/Karachi)</span>
          </div>
          <div className="flex items-center gap-1">
            <Link to="/admin/notifications" className="relative rounded-lg p-2 text-ink-600 hover:bg-ink-100" aria-label={`Notifications${notif.data?.unread ? `, ${notif.data.unread} unread` : ''}`}>
              <Bell className="h-5 w-5" />
              {!!notif.data?.unread && <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-red-500" />}
            </Link>
            <button onClick={signOut} className="rounded-lg p-2 text-ink-600 hover:bg-ink-100" aria-label="Sign out" title="Sign out">
              <LogOut className="h-5 w-5" />
            </button>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6">{children}</main>
      </div>
    </div>
  );
}
