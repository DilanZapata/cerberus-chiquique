import { createContext, ReactNode, useContext, useEffect, useState } from 'react';
import { clearSession, loadSession, saveSession, Session } from '../services/auth';
import { login as loginRequest } from '../services/api';

interface AuthContextValue {
  session: Session | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadSession()
      .then(setSession)
      .finally(() => setLoading(false));
  }, []);

  async function login(email: string, password: string) {
    const result = await loginRequest(email, password);
    await saveSession(result.accessToken, result.user);
    setSession({ accessToken: result.accessToken, user: result.user });
  }

  async function logout() {
    await clearSession();
    setSession(null);
  }

  return <AuthContext.Provider value={{ session, loading, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  return ctx;
}
