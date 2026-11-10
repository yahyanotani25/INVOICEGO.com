import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth';
import { Spinner } from './components/ui';
import AppLayout from './components/AppLayout';
import Landing from './pages/public/Landing';
import { Login, Register, VerifyEmail, ForgotPassword, ResetPassword, AcceptInvite } from './pages/public/Auth';

const Dashboard = lazy(() => import('./pages/app/Dashboard'));
const Invoices = lazy(() => import('./pages/app/Invoices'));
const InvoiceBuilder = lazy(() => import('./pages/app/InvoiceBuilder'));
const InvoiceView = lazy(() => import('./pages/app/InvoiceView'));
const InvoicePrint = lazy(() => import('./pages/app/InvoicePrint'));
const Customers = lazy(() => import('./pages/app/Customers'));
const Products = lazy(() => import('./pages/app/Products'));
const HsCodes = lazy(() => import('./pages/app/HsCodes'));
const Sandbox = lazy(() => import('./pages/app/Sandbox'));
const FbrIntegration = lazy(() => import('./pages/app/FbrIntegration'));
const Reports = lazy(() => import('./pages/app/Reports'));
const Settings = lazy(() => import('./pages/app/Settings'));
const Notifications = lazy(() => import('./pages/app/Notifications'));
const AdminApp = lazy(() => import('./pages/admin/AdminApp'));
const CreateBusiness = lazy(() => import('./components/CreateBusiness'));

function RequireUser({ children }: { children: ReactNode }) {
  const { me, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <Spinner />;
  if (!me) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Suspense fallback={<Spinner />}>
      <Routes>
        <Route path="/admin/*" element={<AdminApp />} />
        <Route
          path="*"
          element={
            <AuthProvider>
              <Routes>
                <Route path="/" element={<Landing />} />
                <Route path="/login" element={<Login />} />
                <Route path="/register" element={<Register />} />
                <Route path="/verify-email" element={<VerifyEmail />} />
                <Route path="/forgot-password" element={<ForgotPassword />} />
                <Route path="/reset-password" element={<ResetPassword />} />
                <Route path="/accept-invite" element={<AcceptInvite />} />
                <Route path="/app/invoices/:id/print" element={<RequireUser><InvoicePrint /></RequireUser>} />
                <Route
                  path="/app/*"
                  element={
                    <RequireUser>
                      <AppLayout>
                        <Suspense fallback={<Spinner />}>
                          <Routes>
                            <Route index element={<Dashboard />} />
                            <Route path="invoices" element={<Invoices />} />
                            <Route path="invoices/new" element={<InvoiceBuilder />} />
                            <Route path="invoices/:id" element={<InvoiceView />} />
                            <Route path="invoices/:id/edit" element={<InvoiceBuilder />} />
                            <Route path="customers" element={<Customers />} />
                            <Route path="products" element={<Products />} />
                            <Route path="hs-codes" element={<HsCodes />} />
                            <Route path="sandbox" element={<Sandbox />} />
                            <Route path="fbr" element={<FbrIntegration />} />
                            <Route path="reports" element={<Reports />} />
                            <Route path="settings" element={<Settings />} />
                            <Route path="notifications" element={<Notifications />} />
                            <Route path="businesses/new" element={<CreateBusiness firstBusiness={false} />} />
                            <Route path="*" element={<Navigate to="/app" replace />} />
                          </Routes>
                        </Suspense>
                      </AppLayout>
                    </RequireUser>
                  }
                />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </AuthProvider>
          }
        />
      </Routes>
    </Suspense>
  );
}
