import AsyncStorage from '@react-native-async-storage/async-storage';

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

export interface Session {
  accessToken: string;
  user: StoredUser;
}

export async function saveSession(accessToken: string, user: StoredUser): Promise<void> {
  await AsyncStorage.multiSet([
    [TOKEN_KEY, accessToken],
    [USER_KEY, JSON.stringify(user)],
  ]);
}

export async function loadSession(): Promise<Session | null> {
  const [[, accessToken], [, rawUser]] = await AsyncStorage.multiGet([TOKEN_KEY, USER_KEY]);
  if (!accessToken || !rawUser) return null;
  return { accessToken, user: JSON.parse(rawUser) };
}

export async function clearSession(): Promise<void> {
  await AsyncStorage.multiRemove([TOKEN_KEY, USER_KEY]);
}

/** Roles con acceso al panel administrativo (todo lo que no sea empleado raso). */
export function isAdminRole(role: string): boolean {
  return role === 'ADMIN' || role === 'HR' || role === 'SUPERVISOR';
}
