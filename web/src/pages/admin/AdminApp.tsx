import { useEffect, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAdminMe, type AdminMe } from '@/lib/auth';
import { Alert, Spinner } from '@/components/ui';
import AdminLayout from '@/components/admin/AdminLayout';
import { setAdminUnauthorizedHandler } from '@/components/admin/adminApi';
import { AcceptInvite, AdminLogin } from './AdminAuth';
import AdminDashboard from './AdminDashboard';
import { AdminUserDetail, AdminUsers } from './AdminUsers';
import { AdminInvoiceDetail, AdminInvoices } from './AdminInvoices';
import AdminFbr from './AdminFbr';
import AdminReports from './AdminReports';
import { AdminSupport, AdminSupportTicket } from './AdminSupport';
import AdminNotifications from './AdminNotifications';
import AdminSettings from './AdminSettings';
import AdminSecurity from './AdminSecurity';
import AdminBackups from './AdminBackups';

function Perm({ me, perm, children }: { me: AdminMe; perm?: string; children: ReactNode }) {
  if (perm && !me.permissions.includes(perm)) {
    return <Alert tone="amber" title="Not permitted">Your administrator role ({me.role.replace('_', ' ')}) does not include access to this section.</Alert>;
  }
  return <>{children}</>;
}

function Protected() {
  const me = useAdminMe();
  const qc = useQueryClient();
  const loc = useLocation();
  useEffect(() => {
    setAdminUnauthorizedHandler(() => void qc.invalidateQueries({ queryKey: ['admin-me'] }));
    return () => setAdminUnauthorizedHandler(null);
  }, [qc]);
  if (me.isLoading) return <Spinner />;
  if (me.error) return <div className="p-6"><Alert tone="red" title="Unable to reach the server">Reload the page to try again.</Alert></div>;
  if (!me.data || !me.data.mfaVerified) return <Navigate to="/admin/login" replace state={{ from: loc.pathname }} />;
  const m = me.data;
  return (
    <AdminLayout me={m}>
      <Routes>
        <Route index element={<AdminDashboard />} />
        <Route path="users" element={<Perm me={m} perm="users.read"><AdminUsers /></Perm>} />
        <Route path="users/:id" element={<Perm me={m} perm="users.read"><AdminUserDetail me={m} /></Perm>} />
        <Route path="invoices" element={<Perm me={m} perm="invoices.read"><AdminInvoices /></Perm>} />
        <Route path="invoices/:id" element={<Perm me={m} perm="invoices.read"><AdminInvoiceDetail me={m} /></Perm>} />
        <Route path="fbr" element={<Perm me={m} perm="fbr.read"><AdminFbr /></Perm>} />
        <Route path="reports" element={<Perm me={m} perm="reports.read"><AdminReports /></Perm>} />
        <Route path="support" element={<Perm me={m} perm="support.read"><AdminSupport /></Perm>} />
        <Route path="support/:id" element={<Perm me={m} perm="support.read"><AdminSupportTicket me={m} /></Perm>} />
        <Route path="notifications" element={<AdminNotifications me={m} />} />
        <Route path="settings" element={<Perm me={m} perm="settings.read"><AdminSettings me={m} /></Perm>} />
        <Route path="security" element={<Perm me={m} perm="security.read"><AdminSecurity me={m} /></Perm>} />
        <Route path="backups" element={<Perm me={m} perm="settings.read"><AdminBackups me={m} /></Perm>} />
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Routes>
    </AdminLayout>
  );
}

/** Administrator application, mounted at /admin/* — separate session, CSRF token and navigation. */
export default function AdminApp() {
  return (
    <Routes>
      <Route path="login" element={<AdminLogin />} />
      <Route path="accept-invite" element={<AcceptInvite />} />
      <Route path="*" element={<Protected />} />
    </Routes>
  );
}
