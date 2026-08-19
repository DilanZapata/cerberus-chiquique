'use client';

const TOKEN_KEY = 'cerberus_token';
const USER_KEY = 'cerberus_user';

export interface StoredUser {
  id: string;
  companyId: string;
  fullName: string;
  email: string | null;
  role: string;
  employeeCode: string;
}

export function saveSession(accessToken: string, user: StoredUser) {
  localStorage.setItem(TOKEN_KEY, accessToken);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function getUser(): StoredUser | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(USER_KEY);
  return raw ? JSON.parse(raw) : null;
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

/** Atajo para el companyId del usuario logueado: casi toda la app opera sobre "mi empresa". */
export function getCompanyId(): string | null {
  return getUser()?.companyId ?? null;
}
