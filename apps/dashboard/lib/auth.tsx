'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api, onTokenChange, refreshAccessToken, setAccessToken } from './api';
import type { User } from './types';

interface AuthState {
  status: 'loading' | 'authenticated' | 'anonymous';
  user: User | null;
  login(email: string, password: string): Promise<void>;
  register(tenantName: string, email: string, password: string): Promise<void>;
  logout(): Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

interface AuthResponse {
  accessToken: string;
  user: User;
}

interface Me {
  sub: string;
  tenantId: string;
  email: string;
  role: User['role'];
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<AuthState['status']>('loading');

  const loadMe = useCallback(async () => {
    const me = await api<Me>('/auth/me');
    setUser({ id: me.sub, tenantId: me.tenantId, email: me.email, role: me.role });
    setStatus('authenticated');
  }, []);

  // Restore the session from the refresh cookie on first load.
  useEffect(() => {
    let cancelled = false;
    void refreshAccessToken().then(async (token) => {
      if (cancelled) return;
      if (!token) {
        setStatus('anonymous');
        return;
      }
      try {
        await loadMe();
      } catch {
        setStatus('anonymous');
      }
    });
    const off = onTokenChange((token) => {
      if (!token) {
        setUser(null);
        setStatus('anonymous');
      }
    });
    return () => {
      cancelled = true;
      off();
    };
  }, [loadMe]);

  const value = useMemo<AuthState>(
    () => ({
      status,
      user,
      async login(email, password) {
        const res = await api<AuthResponse>('/auth/login', {
          method: 'POST',
          json: { email, password },
        });
        setAccessToken(res.accessToken);
        setUser(res.user);
        setStatus('authenticated');
      },
      async register(tenantName, email, password) {
        const res = await api<AuthResponse>('/auth/register', {
          method: 'POST',
          json: { tenantName, email, password },
        });
        setAccessToken(res.accessToken);
        setUser(res.user);
        setStatus('authenticated');
      },
      async logout() {
        await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
        setAccessToken(null);
      },
    }),
    [status, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}

export function canConfigure(user: User | null): boolean {
  return user?.role === 'owner' || user?.role === 'admin';
}
