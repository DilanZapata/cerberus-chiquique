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

const NO_CONNECTION_MESSAGE = 'Sin conexion con el servidor. Revisa el internet e intenta de nuevo.';

async function handle(res: Response) {
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const message = Array.isArray(body?.message) ? body.message[0] : body?.message;
    const err = new ApiError(message ?? `Error ${res.status}`);
    if (typeof body?.secondsRemaining === 'number') err.secondsRemaining = body.secondsRemaining;
    throw err;
  }
  return res.json();
}

// El kiosco hace solicitudes automaticas sin que nadie las este mirando
// (sondeo de camara + el marcaje real): una solicitud colgada NUNCA debe
// dejar el estado de procesamiento atascado indefinidamente, por eso estas
// llamadas van con un limite de tiempo explicito.
const KIOSK_REQUEST_TIMEOUT_MS = 15000;

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new ApiError('El servidor no respondio a tiempo. Intenta de nuevo.');
    }
    throw new ApiError(NO_CONNECTION_MESSAGE);
  } finally {
    clearTimeout(timer);
  }
}

/** Llamada autenticada generica al backend (panel administrativo). */
async function apiRequest(token: string, path: string, options: RequestInit = {}) {
  const headers = new Headers(options.headers);
  headers.set('Authorization', `Bearer ${token}`);
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { ...options, headers });
  } catch {
    throw new ApiError(NO_CONNECTION_MESSAGE);
  }
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
 * el empleado se identifica con UN solo valor (cedula, codigo, o PIN).
 */
export async function kioskClock(params: {
  latitude: number;
  longitude: number;
  identifier: string;
  imageBase64?: string;
}): Promise<KioskClockResult> {
  const res = await fetchWithTimeout(
    `${API_URL}/kiosk/clock`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params) },
    KIOSK_REQUEST_TIMEOUT_MS,
  );
  return handle(res);
}

/**
 * Modo Kiosco por reconocimiento facial: misma deteccion de sede por GPS; el
 * celular solo toma la foto y la sube, todo el reconocimiento ocurre en el
 * backend propio (nunca en un servicio de terceros). Esta es la llamada que
 * REALMENTE registra la marca (sujeta al guard de 5 minutos del backend).
 */
export async function kioskFaceClock(params: {
  latitude: number;
  longitude: number;
  imageBase64: string;
}): Promise<KioskClockResult> {
  const res = await fetchWithTimeout(
    `${API_URL}/kiosk/face-clock`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params) },
    KIOSK_REQUEST_TIMEOUT_MS,
  );
  return handle(res);
}

export interface KioskFaceProbeResult {
  recognized: boolean;
  fullName?: string;
  distance?: number;
}

/**
 * Solo identifica el rostro de la foto, SIN registrar ninguna marca -- para
 * el sondeo periodico de la camara del kiosco mientras busca a alguien
 * frente a ella. Nunca lanza por "no se detecto rostro" (el backend lo
 * trata como resultado normal, ver KioskService.identifyFace): solo puede
 * fallar por un problema real de red/servidor.
 */
export async function kioskFaceProbe(params: { latitude: number; longitude: number; imageBase64: string }): Promise<KioskFaceProbeResult> {
  const res = await fetchWithTimeout(
    `${API_URL}/kiosk/face-probe`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params) },
    KIOSK_REQUEST_TIMEOUT_MS,
  );
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
  const res = await fetchWithTimeout(
    `${API_URL}/auth/login`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) },
    KIOSK_REQUEST_TIMEOUT_MS,
  );
  return handle(res);
}

/** Ingreso con cedula + PIN (Cerberus Managers). */
export async function loginWithPin(nationalId: string, pin: string): Promise<LoginResult> {
  const res = await fetchWithTimeout(
    `${API_URL}/auth/login-pin`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nationalId, pin }) },
    KIOSK_REQUEST_TIMEOUT_MS,
  );
  return handle(res);
}

// ---- Asistente (chat) de Cerberus Managers ----

export interface AssistantChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** Autorizacion de horas extra que el asistente dejo lista: no queda hecha hasta confirmarla. */
export interface AssistantProposal {
  token: string;
  expiresAt: string;
  employee: { id: string; fullName: string; employeeCode: string };
  days: Array<{
    date: string;
    hours: number;
    mode: 'PENDIENTES' | 'TOTAL';
    reason: string;
    workedHours: number;
    currentAuthorizedHours: number;
    pendingHours: number;
    resultingAuthorizedHours: number;
  }>;
}

export interface AssistantReply {
  reply: string;
  pendingAction: AssistantProposal | null;
}

// El asistente consulta datos y habla con el modelo: puede tardar bastante mas que una llamada normal.
const ASSISTANT_TIMEOUT_MS = 70000;

async function assistantRequest(token: string, path: string, body: unknown) {
  const res = await fetchWithTimeout(
    `${API_URL}${path}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) },
    ASSISTANT_TIMEOUT_MS,
  );
  return handle(res);
}

/** Envia la conversacion al asistente y devuelve su respuesta (y, si aplica, una autorizacion por confirmar). */
export function assistantChat(token: string, messages: AssistantChatMessage[]): Promise<AssistantReply> {
  return assistantRequest(token, '/assistant/chat', { messages });
}

/** Confirma (ejecuta) la autorizacion de horas extra que el asistente dejo propuesta. */
export function assistantConfirm(
  token: string,
  proposalToken: string,
): Promise<{ message: string; employee: string; days: Array<{ date: string; authorizedHours: number; pendingHours: number; reason: string }> }> {
  return assistantRequest(token, '/assistant/confirm', { token: proposalToken });
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
  const res = await fetchWithTimeout(`${API_URL}/time-logs/mobile-clock`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(coords),
  }, 20000);
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
  workSites: WorkSite[];
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
    workSiteIds?: string[];
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
    workSiteIds: string[];
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

// ---- Horas extra (mismos endpoints que usa el panel web) ----

export interface PendingOvertime {
  id: string;
  /** Horas extra que siguen pendientes de decidir. */
  requestedHours: string;
  status: string;
  createdAt: string;
  /** Lo que ya se habia autorizado para ese dia (0 si nada). */
  authorizedHours: number;
  authorizedByName: string | null;
  /** Horas extra que realmente trabajo ese dia. */
  workedHours: number;
  pendingHours: number;
  novelty: { userId: string; workDate: string; hours: string; notes: string | null; user: { fullName: string; employeeCode: string } };
}

export function getPendingOvertime(token: string): Promise<PendingOvertime[]> {
  return apiRequest(token, '/novelties/overtime/pending');
}

export function reviewOvertime(token: string, id: string, body: { status: 'APROBADA' | 'RECHAZADA'; approvedHours?: number; notes?: string }) {
  return apiRequest(token, `/novelties/overtime/${id}/review`, { method: 'POST', body: JSON.stringify(body) });
}

/** Si el rol del usuario esta habilitado por su empresa para autorizar horas extra. */
export function getOvertimePermissions(token: string): Promise<{ canApprove: boolean; role: string; approverRoles: string[] }> {
  return apiRequest(token, '/novelties/overtime/permissions');
}

/** Autorizacion de horas extra de una persona en un dia, con lo que realmente trabajo. */
export interface OvertimeAuthorization {
  userId: string;
  fullName: string;
  employeeCode: string;
  workDate: string;
  authorizedHours: number;
  excessRejected: boolean;
  authorizedByName: string | null;
  notes: string | null;
  updatedAt: string | null;
  workedHours: number;
  /** Lo que se paga: lo menor entre lo autorizado y lo trabajado. */
  approvedHours: number;
  pendingHours: number;
  rejectedHours: number;
}

/** "A esta persona, este dia, le autorizo N horas extra" (reemplaza la autorizacion anterior de ese dia). */
export function authorizeOvertime(
  token: string,
  body: { userId: string; workDate: string; hours: number; notes?: string },
): Promise<OvertimeAuthorization> {
  return apiRequest(token, '/novelties/overtime/authorizations', { method: 'POST', body: JSON.stringify(body) });
}

export function getOvertimeAuthorizations(token: string, from: string, to: string): Promise<OvertimeAuthorization[]> {
  return apiRequest(token, `/novelties/overtime/authorizations?from=${from}&to=${to}`);
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
  /** Foto comparada con el rostro enrolado (null = marca sin verificar). */
  faceCheck: 'MATCH' | 'MISMATCH' | 'NOT_ENROLLED' | null;
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
