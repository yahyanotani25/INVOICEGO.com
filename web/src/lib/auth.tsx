import { createContext, useContext, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, setCsrf } from './api';

export interface Me {
  user: { id: string; name: string; email: string; phone: string | null; emailVerified: boolean };
  csrfToken: string;
  sessionId: string;
  businesses: { id: string; name: string; role: string }[];
  business: { id: string; name: string; role: string; productionEnabled: boolean; ntnCnic: string } | null;
}

interface Ctx {
  me: Me | null;
  loading: boolean;
  refresh: () => Promise<void>;
  setMe: (m: Me | null) => void;
  logout: () => Promise<void>;
  can: (action: 'write' | 'submit' | 'fbr' | 'manage') => boolean;
}

const AuthCtx = createContext<Ctx>(null as never);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const q = useQuery<Me | null>({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        const m = await api<Me>('/api/auth/me');
        setCsrf('app', m.csrfToken);
        return m;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 60_000,
    retry: false,
  });
  const me = q.data ?? null;
  const role = me?.business?.role;
  const value: Ctx = {
    me,
    loading: q.isLoading,
    refresh: async () => {
      await qc.invalidateQueries({ queryKey: ['me'] });
    },
    setMe: (m) => {
      if (m) setCsrf('app', m.csrfToken);
      qc.setQueryData(['me'], m);
    },
    logout: async () => {
      try {
        await api('/api/auth/logout', { method: 'POST', body: {} });
      } finally {
        setCsrf('app', null);
        qc.clear();
        qc.setQueryData(['me'], null);
      }
    },
    can: (a) => {
      if (!role) return false;
      if (a === 'write' || a === 'submit') return ['OWNER', 'ADMIN', 'ACCOUNTANT', 'OPERATOR'].includes(role);
      return ['OWNER', 'ADMIN'].includes(role);
    },
  };
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);

// ---------------------------------------------------------------- admin
export interface AdminMe {
  user: { id: string; name: string; email: string };
  role: string;
  permissions: string[];
  mfaVerified: boolean;
  needsEnrollment: boolean;
  csrfToken: string;
}

export function useAdminMe() {
  return useQuery<AdminMe | null>({
    queryKey: ['admin-me'],
    queryFn: async () => {
      try {
        const m = await api<AdminMe>('/api/admin/auth/me');
        setCsrf('admin', m.csrfToken);
        return m;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    retry: false,
    staleTime: 30_000,
  });
}
