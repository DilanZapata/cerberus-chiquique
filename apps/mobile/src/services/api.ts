const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3001/api';
// Los archivos estaticos (fotos de marcaje) se sirven en la raiz del servidor,
// fuera del prefijo /api (ver useStaticAssets en apps/api/src/main.ts).
const API_ORIGIN = API_URL.replace(/\/api\/?$/, '');

/**
 * Error con campos extra que algunos endpoints agregan al cuerpo del error
 * (ej. `secondsRemaining` del guard de registros duplicados en
 * kiosco/mobile-clock) ademas del `message` de siempre, para que la UI
 * pueda mostrar un contador sin tener que parsear el texto.
 */
export class ApiError extends Error {
  secondsRemaining?: number;
}

async function handle(res: Response) {
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const err = new ApiError(body?.message ?? `Error ${res.status}`);
    if (typeof body?.secondsRemaining === 'number') err.secondsRemaining = body.secondsRemaining;
    throw err;
  }
  return res.json();
}

/** Llamada autenticada generica al backend (panel administrativo). */
async function apiRequest(token: string, path: string, options: RequestInit = {}) {
  const headers = new Headers(options.headers);
  headers.set('Authorization', `Bearer ${token}`);
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const res = await fetch(`${API_URL}${path}`, { ...options, headers });
  return handle(res);
}

export interface KioskClockResult {
  fullName: string;
  employeeCode: string;
  logType: 'CHECK_IN' | 'LUNCH_OUT' | 'LUNCH_IN' | 'CHECK_OUT';
  loggedAt: string;
}

/**
 * Modo Kiosco: sin token ni sede configurados en el dispositivo. El backend
 * identifica la sede (y la empresa) por proximidad GPS del propio telefono;
 * el empleado se identifica con su codigo + PIN.
 */
export async function kioskClock(params: {
  latitude: number;
  longitude: number;
  employeeCode: string;
  pin: string;
  imageBase64?: string;
}): Promise<KioskClockResult> {
  const res = await fetch(`${API_URL}/kiosk/clock`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return handle(res);
}

/**
 * Modo Kiosco por reconocimiento facial: misma deteccion de sede por GPS; el
 * celular solo toma la foto y la sube, todo el reconocimiento ocurre en el
 * backend propio (nunca en un servicio de terceros).
 */
export async function kioskFaceClock(params: {
  latitude: number;
  longitude: number;
  imageBase64: string;
}): Promise<KioskClockResult> {
  const res = await fetch(`${API_URL}/kiosk/face-clock`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return handle(res);
}

export interface LoginResult {
  accessToken: string;
  user: {
    id: string;
    companyId: string;
    fullName: string;
    email: string | null;
    role: string;
    employeeCode: string;
  };
}

export async function login(email: string, password: string): Promise<LoginResult> {
  const res = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  return handle(res);
}

export interface MobileClockResult {
  logType: 'CHECK_IN' | 'LUNCH_OUT' | 'LUNCH_IN' | 'CHECK_OUT';
  loggedAt: string;
  distanceMeters: number;
}

/** Modo Empleado: marcaje personal validado por GPS, requiere sesion JWT. */
export async function mobileClock(
  accessToken: string,
  coords: { latitude: number; longitude: number; imageBase64?: string },
): Promise<MobileClockResult> {
  const res = await fetch(`${API_URL}/time-logs/mobile-clock`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(coords),
  });
  return handle(res);
}

// ---- Panel administrativo (ADMIN / HR / SUPERVISOR) ----

export interface CompanyInfo {
  id: string;
  nit: string;
  legalName: string;
  tradeName: string | null;
}

export function getMyCompany(token: string): Promise<CompanyInfo> {
  return apiRequest(token, '/companies/me');
}

export interface Department {
  id: string;
  name: string;
}

export function getDepartments(token: string): Promise<Department[]> {
  return apiRequest(token, '/companies/me/departments');
}

export interface WorkSite {
  id: string;
  name: string;
  kioskToken?: string | null;
}

export function getWorkSites(token: string): Promise<WorkSite[]> {
  return apiRequest(token, '/companies/me/work-sites');
}

export interface ScheduleSummary {
  id: string;
  name: string;
}

export function getSchedules(token: string): Promise<ScheduleSummary[]> {
  return apiRequest(token, '/companies/me/schedules');
}

export interface Employee {
  id: string;
  employeeCode: string;
  nationalId: string;
  fullName: string;
  email: string | null;
  role: string;
  isActive: boolean;
  allowsLunchSkip: boolean;
  baseSalary: string;
  department: Department | null;
  workSite: WorkSite | null;
}

export function getEmployees(token: string): Promise<Employee[]> {
  return apiRequest(token, '/users');
}

export function createEmployee(
  token: string,
  body: {
    employeeCode: string;
    nationalId: string;
    fullName: string;
    email?: string;
    role?: string;
    departmentId?: string;
    workSiteId?: string;
    scheduleId?: string;
    hireDate: string;
    baseSalary?: number;
    allowsLunchSkip?: boolean;
    password?: string;
    pin?: string;
  },
): Promise<Employee> {
  return apiRequest(token, '/users', { method: 'POST', body: JSON.stringify(body) });
}

export function updateEmployee(
  token: string,
  id: string,
  body: Partial<{
    fullName: string;
    email: string;
    role: string;
    departmentId: string;
    workSiteId: string;
    baseSalary: number;
    allowsLunchSkip: boolean;
    isActive: boolean;
    password: string;
    pin: string;
  }>,
) {
  return apiRequest(token, `/users/${id}`, { method: 'PUT', body: JSON.stringify(body) });
}

export function deactivateEmployee(token: string, id: string) {
  return apiRequest(token, `/users/${id}/deactivate`, { method: 'POST' });
}

// ---- Reconocimiento facial ----

export function enrollFace(token: string, body: { userId: string; imageBase64: string; consentText: string }) {
  return apiRequest(token, '/face/enroll', { method: 'POST', body: JSON.stringify(body) });
}

export function revokeFace(token: string, userId: string) {
  return apiRequest(token, `/face/enroll/${userId}`, { method: 'DELETE' });
}

export function getFaceStatus(token: string, userId: string): Promise<{ enrolled: boolean; consentGivenAt: string | null }> {
  return apiRequest(token, `/face/status/${userId}`);
}

// ---- Dashboard ----

export interface AttendanceRow {
  user: { id: string; employeeCode: string; fullName: string; department: string | null; workSite: string | null };
  marks: { checkIn: string | null; lunchOut: string | null; lunchIn: string | null; checkOut: string | null };
  novelties: Array<{ code: string; hours: number; status: string; notes: string | null }>;
}

export function getAttendance(token: string, date: string): Promise<AttendanceRow[]> {
  return apiRequest(token, `/dashboard/attendance?date=${date}`);
}

// ---- Historial de marcas (coordenadas + foto de evidencia) ----

export interface TimeLogHistoryEntry {
  id: string;
  logType: 'CHECK_IN' | 'LUNCH_OUT' | 'LUNCH_IN' | 'CHECK_OUT';
  loggedAt: string;
  source: 'KIOSK' | 'MOBILE_GPS' | 'WEB' | 'MANUAL';
  latitude: number | null;
  longitude: number | null;
  gpsValid: boolean | null;
  photoUrl: string | null;
  workSite: string | null;
}

/** Sin userId, el backend devuelve el historial propio (rol EMPLOYEE); con userId, el de ese empleado (roles admin). */
export function getTimeLogHistory(token: string, from: string, to: string, userId?: string): Promise<TimeLogHistoryEntry[]> {
  const query = userId ? `userId=${userId}&from=${from}&to=${to}` : `from=${from}&to=${to}`;
  return apiRequest(token, `/time-logs/history?${query}`);
}

export function photoUrl(relativePath: string): string {
  return `${API_ORIGIN}${relativePath}`;
}
