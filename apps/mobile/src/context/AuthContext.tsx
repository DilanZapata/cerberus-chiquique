import { createContext, ReactNode, useContext, useEffect, useState } from 'react';
import { clearSession, isAdminRole, loadSession, saveSession, Session } from '../services/auth';
import { login as loginRequest, loginWithPin as loginWithPinRequest, LoginResult } from '../services/api';
import { IS_MANAGERS } from '../config/variant';

interface AuthContextValue {
  session: Session | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  /** Ingreso con cedula + PIN (Cerberus Managers). */
  loginWithPin: (nationalId: string, pin: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadSession()
      // Managers nunca abre con una sesion de empleado raso.
      .then((saved) => setSession(saved && IS_MANAGERS && !isAdminRole(saved.user.role) ? null : saved))
      .finally(() => setLoading(false));
  }, []);

  async function startSession(result: LoginResult) {
    if (IS_MANAGERS && !isAdminRole(result.user.role)) {
      // No se guarda la sesion: Managers es solo para quienes administran.
      throw new Error(
        'Esta app es solo para administradores, RRHH y supervisores. Para marcar tu asistencia usa la app Cerberus Staff.',
      );
    }
    await saveSession(result.accessToken, result.user);
    setSession({ accessToken: result.accessToken, user: result.user });
  }

  async function login(email: string, password: string) {
    await startSession(await loginRequest(email, password));
  }

  async function loginWithPin(nationalId: string, pin: string) {
    await startSession(await loginWithPinRequest(nationalId, pin));
  }

  async function logout() {
    await clearSession();
    setSession(null);
  }

  return <AuthContext.Provider value={{ session, loading, login, loginWithPin, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  return ctx;
}
