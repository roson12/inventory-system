import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { api, clearCsrf } from './api';
import type { Me } from '@/types';

interface AuthContextValue {
  me: Me | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<Me>;
  register: (input: { name: string; email: string; password: string; phone?: string }) => Promise<Me>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  can: (permission: string) => boolean;
  hasRole: (...roles: Me['role'][]) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ['me'],
    queryFn: () => api<Me>('/auth/me'),
    retry: false,
    staleTime: 60_000,
  });

  useEffect(() => {
    const handler = () => {
      queryClient.setQueryData(['me'], null);
    };
    window.addEventListener('auth:unauthorized', handler);
    return () => window.removeEventListener('auth:unauthorized', handler);
  }, [queryClient]);

  const value = useMemo<AuthContextValue>(
    () => ({
      me: (data as Me | null | undefined) ?? null,
      isLoading,
      async login(email, password) {
        const me = await api<Me>('/auth/login', { method: 'POST', body: { email, password } });
        queryClient.setQueryData(['me'], me);
        return me;
      },
      async register(input) {
        const me = await api<Me>('/auth/register', { method: 'POST', body: input });
        queryClient.setQueryData(['me'], me);
        return me;
      },
      async logout() {
        try {
          await api('/auth/logout', { method: 'POST' });
        } finally {
          clearCsrf();
          queryClient.setQueryData(['me'], null);
          queryClient.clear();
          navigate('/login');
        }
      },
      async refresh() {
        const me = await api<Me>('/auth/me');
        queryClient.setQueryData(['me'], me);
      },
      can(permission) {
        if (!data) return false;
        return data.role === 'SUPER_ADMIN' || data.permissions.includes(permission);
      },
      hasRole(...roles) {
        return Boolean(data && roles.includes(data.role));
      },
    }),
    [data, isLoading, queryClient, navigate],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}

export function useNotifyError(error: unknown) {
  const message = error instanceof Error ? error.message : 'Something went wrong';
  toast.error(message);
}
