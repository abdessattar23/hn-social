'use client';
import { createContext, useContext, useState, useEffect, ReactNode, useCallback, useMemo } from 'react';

type AuthCtx = {
  token: string | null;
  ready: boolean;
  orgId: number | null;
  role: string | null;
  login: (token: string, refreshToken?: string) => void;
  logout: () => void;
};

const AuthContext = createContext<AuthCtx>({
  token: null,
  ready: false,
  orgId: null,
  role: null,
  login: () => {},
  logout: () => {},
});

function parseJwt(token: string): Record<string, any> | null {
  try {
    const base64 = token.split('.')[1];
    const json = atob(base64.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const t = localStorage.getItem('token');
    setToken(t);
    setReady(true);
  }, []);

  const login = useCallback((t: string, refreshToken?: string) => {
    localStorage.setItem('token', t);
    if (refreshToken) localStorage.setItem('refreshToken', refreshToken);
    setToken(t);
    window.location.href = '/';
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('token');
    localStorage.removeItem('refreshToken');
    setToken(null);
    window.location.href = '/login';
  }, []);

  const decoded = useMemo(() => (token ? parseJwt(token) : null), [token]);
  const orgId = decoded?.orgId ?? decoded?.user_metadata?.orgId ?? null;
  const role = decoded?.role ?? decoded?.user_metadata?.role ?? null;

  return (
    <AuthContext.Provider value={{ token, ready, orgId, role, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
