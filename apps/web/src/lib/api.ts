import { clearSession, getToken, saveSession, StoredUser } from './auth';

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';
// Los archivos estaticos (fotos de marcaje) se sirven en la raiz del servidor,
// fuera del prefijo /api (ver useStaticAssets en apps/api/src/main.ts).
const API_ORIGIN = API_URL.replace(/\/api\/?$/, '');

/** El backend guarda solo la ruta relativa (la IP/host del API cambia entre entornos). */
export function photoUrl(relativePath: string): string {
  return `${API_ORIGIN}${relativePath}`;
}

export async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const token = getToken();
  const headers = new Headers(options.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

  const res = await fetch(`${API_URL}${path}`, { ...options, headers, cache: 'no-store' });

  if (res.status === 401 && typeof window !== 'undefined') {
    clearSession();
    window.location.href = '/login';
  }
  return res;
}

async function apiJson<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await apiFetch(path, options);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.message ?? `Error ${res.status} al llamar ${path}`);
  }
  return res.json();
}

// ---- Auth ----

export async function login(email: string, password: string): Promise<StoredUser> {
  const res = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error('Credenciales invalidas');
  const data = await res.json();
  saveSession(data.accessToken, data.user);
  return data.user;
}

// ---- Dashboard ----

export interface AttendanceRow {
  user: { id: string; employeeCode: string; fullName: string; department: string | null; workSite: string | null };
  marks: { checkIn: string | null; lunchOut: string | null; lunchIn: string | null; checkOut: string | null };
  novelties: Array<{ code: string; hours: number; status: string; notes: string | null }>;
}

export function getAttendance(date: string): Promise<AttendanceRow[]> {
  return apiJson(`/dashboard/attendance?date=${date}`);
}

// ---- Horas extra ----

export interface PendingOvertime {
  id: string;
  requestedHours: string;
  status: string;
  createdAt: string;
  novelty: { workDate: string; hours: string; notes: string | null; user: { fullName: string; employeeCode: string } };
}

export function getPendingOvertime(): Promise<PendingOvertime[]> {
  return apiJson('/novelties/overtime/pending');
}

export function reviewOvertime(
  id: string,
  body: { status: 'APROBADA' | 'RECHAZADA'; approvedHours?: number; notes?: string },
) {
  return apiJson(`/novelties/overtime/${id}/review`, { method: 'POST', body: JSON.stringify(body) });
}

// ---- Jornadas abiertas (cierre automatico + revision) ----

export type JornadaAbiertaEstado = 'SIN_HORARIO' | 'PENDIENTE_CIERRE' | 'VENCIDA_CIERRE_AUTOMATICO' | 'CERRADA_PENDIENTE_REVISION';

export interface JornadaAbierta {
  kind: 'ABIERTA' | 'CERRADA_PENDIENTE_REVISION';
  noveltyId?: string;
  userId: string;
  employeeCode: string;
  fullName: string;
  department: string | null;
  workSite: string | null;
  workDate: string;
  estado: JornadaAbiertaEstado;
  checkIn?: string;
  plannedExit?: string | null;
  autoClosedExit?: string | null;
  notes?: string | null;
}

export function getJornadasAbiertas(workDate?: string): Promise<JornadaAbierta[]> {
  return apiJson(`/time-logs/jornadas-abiertas${workDate ? `?workDate=${workDate}` : ''}`);
}

export function reviewJornada(noveltyId: string, body: { status: 'APROBADA' | 'RECHAZADA'; notes?: string }) {
  return apiJson(`/time-logs/jornadas-abiertas/${noveltyId}/review`, { method: 'POST', body: JSON.stringify(body) });
}

// ---- Incidencias (permisos / incapacidades) ----

export interface PendingIncidence {
  id: string;
  code: string;
  startDate: string;
  endDate: string;
  hoursPerDay: string | null;
  notes: string | null;
  user: { fullName: string; employeeCode: string };
}

export function getPendingIncidences(): Promise<PendingIncidence[]> {
  return apiJson('/incidences/pending');
}

export function createIncidence(body: {
  userId: string;
  code: string;
  startDate: string;
  endDate: string;
  hoursPerDay?: number;
  notes?: string;
}) {
  return apiJson('/incidences', { method: 'POST', body: JSON.stringify(body) });
}

export function reviewIncidence(id: string, body: { status: 'APROBADA' | 'RECHAZADA'; notes?: string }) {
  return apiJson(`/incidences/${id}/review`, { method: 'POST', body: JSON.stringify(body) });
}

// ---- Descanso compensatorio ----

export interface PendingRestCredit {
  id: string;
  earnedForDate: string;
  notes: string | null;
  user: { fullName: string; employeeCode: string };
}

export function getPendingRestCredits(): Promise<PendingRestCredit[]> {
  return apiJson('/rest-credits/pending');
}

export function takeRestCredit(id: string, takenDate: string) {
  return apiJson(`/rest-credits/${id}/take`, { method: 'POST', body: JSON.stringify({ takenDate }) });
}

// ---- Turnos rotativos (rutinas) ----

export interface ShiftPatternDayInput {
  dayOffset: number;
  isRestDay: boolean;
  rotationType: 'DIURNO' | 'NOCTURNO' | 'MIXTO' | 'DESCANSO';
  startTime?: string;
  endTime?: string;
  lunchMinutes?: number;
}

export interface ShiftPattern {
  id: string;
  name: string;
  cycleLengthDays: number;
  days: Array<{ dayOffset: number; isRestDay: boolean; rotationType: string; startTime: string | null; endTime: string | null }>;
}

export function getShiftPatterns(companyId: string): Promise<ShiftPattern[]> {
  return apiJson(`/shift-patterns?companyId=${companyId}`);
}

export function createShiftPattern(companyId: string, body: { name: string; cycleLengthDays: number; days: ShiftPatternDayInput[] }) {
  return apiJson(`/shift-patterns?companyId=${companyId}`, { method: 'POST', body: JSON.stringify(body) });
}

export function assignPatternToTeam(
  patternId: string,
  body: { departmentId: string; anchorDate: string; staggerDays?: number },
): Promise<{ assignedCount: number }> {
  return apiJson(`/shift-patterns/${patternId}/assign-team`, { method: 'POST', body: JSON.stringify(body) });
}

export interface SmartRotationSlot {
  index: number;
  startTime: string;
  endTime: string;
  rotationType: string;
}

export interface SmartRotationResult {
  slots: SmartRotationSlot[];
  cycleLengthDays: number;
  warnings: string[];
  workers: Array<{
    userId: string;
    fullName: string;
    slotIndex: number;
    slot: { startTime: string; endTime: string };
    restDayOffsets: number[];
    patternId: string;
    shiftsGenerated: number;
  }>;
}

export function smartGenerateShiftPattern(
  companyId: string,
  body: {
    name: string;
    workerIds: string[];
    coverageStart: string;
    coverageEnd: string;
    shiftHours: number;
    cycleLengthDays?: number;
    restDaysPerWeek?: number;
    anchorDate: string;
    horizonWeeks?: number;
  },
): Promise<SmartRotationResult> {
  return apiJson(`/shift-patterns/smart-generate?companyId=${companyId}`, { method: 'POST', body: JSON.stringify(body) });
}

export function generateShifts(body: {
  departmentId?: string;
  userId?: string;
  from: string;
  to: string;
}): Promise<{ generated: number }> {
  return apiJson('/shift-patterns/generate', { method: 'POST', body: JSON.stringify(body) });
}

// ---- Rutina de ordeño (jornada partida + ciclo de descanso quincenal) ----

export interface MilkingRoutineStation {
  stationIndex: number;
  ordenadores: string[];
  vaquero: string;
  isVaqueroSubstitute: boolean;
}

export interface MilkingRoutineDayResult {
  dayOffset: number;
  stations: MilkingRoutineStation[];
  workersOnShortDay: string[];
  workersResting: string[];
}

export interface MilkingRoutineResult {
  feasible: boolean;
  warnings: string[];
  minimumWorkersNeeded?: number;
  suggestedFullDayWorkerIds?: string[];
  suggestedFullDayWorkerNames?: string[];
  suggestedReducedRestWorkerIds?: string[];
  suggestedReducedRestWorkerNames?: string[];
  cycleLengthDays?: number;
  stationsCount?: number;
  scheduleId?: string;
  workers?: Array<{ userId: string; fullName: string; role: 'ORDENADOR_VAQUERO' | 'COMODIN'; patternId: string; shiftsGenerated: number }>;
  days?: MilkingRoutineDayResult[];
}

export function smartGenerateMilkingRoutine(
  companyId: string,
  body: {
    name: string;
    workerIds: string[];
    comodinWorkerId?: string;
    stationsCount?: number;
    fullDayWorkerIds?: string[];
    reducedRestWorkerIds?: string[];
    vaqueroWorkerIds?: string[];
    anchorDate: string;
    morningStart?: string;
    morningEnd?: string;
    eveningStart?: string;
    eveningEnd?: string;
    horizonWeeks?: number;
  },
): Promise<MilkingRoutineResult> {
  return apiJson(`/shift-patterns/smart-generate-milking?companyId=${companyId}`, { method: 'POST', body: JSON.stringify(body) });
}

// ---- Parametros de nomina (versionado legal) ----

export interface PayrollConfigVersion {
  id: string;
  effectiveFrom: string;
  dayStartTime: string;
  nightStartTime: string;
  maxWeeklyHours: string;
  maxDailyOrdinaryHours: string;
  maxDailyOvertimeHours: string;
  maxWeeklyOvertimeHours: string;
  dominicalOcasionalMaxPerMonth: number;
  pctRecargoNocturno: string;
  pctDominicalFestivo: string;
  pctDominicalFestivoNocturno: string;
  pctHoraExtraDiurna: string;
  pctHoraExtraNocturna: string;
  pctHoraExtraFestivaDiurna: string;
  pctHoraExtraFestivaNocturna: string;
  notes: string | null;
}

export function getPayrollConfigVersions(companyId: string): Promise<PayrollConfigVersion[]> {
  return apiJson(`/payroll-config/${companyId}/versions`);
}

export interface CreatePayrollConfigVersionBody {
  effectiveFrom: string;
  dayStartTime: string;
  nightStartTime: string;
  maxWeeklyHours: number;
  maxDailyOrdinaryHours: number;
  maxDailyOvertimeHours: number;
  maxWeeklyOvertimeHours: number;
  dominicalOcasionalMaxPerMonth: number;
  pctRecargoNocturno: number;
  pctDominicalFestivo: number;
  pctDominicalFestivoNocturno: number;
  pctHoraExtraDiurna: number;
  pctHoraExtraNocturna: number;
  pctHoraExtraFestivaDiurna: number;
  pctHoraExtraFestivaNocturna: number;
  notes?: string;
}

export function createPayrollConfigVersion(companyId: string, body: CreatePayrollConfigVersionBody): Promise<PayrollConfigVersion> {
  return apiJson(`/payroll-config/${companyId}/versions`, { method: 'POST', body: JSON.stringify(body) });
}

export function updatePayrollConfigVersion(
  companyId: string,
  versionId: string,
  body: Partial<CreatePayrollConfigVersionBody>,
): Promise<PayrollConfigVersion> {
  return apiJson(`/payroll-config/${companyId}/versions/${versionId}`, { method: 'PUT', body: JSON.stringify(body) });
}

export interface PayrollSettings {
  overtimeRequiresPreauthorization: boolean;
  overtimePendingAlertDays: number;
}

export function getPayrollSettings(companyId: string): Promise<PayrollSettings> {
  return apiJson(`/payroll-config/${companyId}/settings`);
}

export function updatePayrollSettings(companyId: string, body: Partial<PayrollSettings>): Promise<PayrollSettings> {
  return apiJson(`/payroll-config/${companyId}/settings`, { method: 'PUT', body: JSON.stringify(body) });
}

// ---- Configuracion SMTP ----

export interface EmailSettings {
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpSecurity: 'NONE' | 'TLS' | 'SSL';
  fromName: string;
  fromEmail: string;
  adminRecipients: string[];
  weeklyAlertEnabled: boolean;
}

export async function getEmailSettings(companyId: string): Promise<EmailSettings | null> {
  const res = await apiFetch(`/email-settings/${companyId}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Error ${res.status} al consultar configuracion SMTP`);
  return res.json();
}

export function upsertEmailSettings(
  companyId: string,
  body: EmailSettings & { smtpPassword: string },
) {
  return apiJson(`/email-settings/${companyId}`, { method: 'PUT', body: JSON.stringify(body) });
}

export function sendWeeklySummaryNow(
  companyId: string,
): Promise<{ sent: boolean; recipients?: string[]; reason?: string }> {
  return apiJson(`/notifications/send-weekly-summary/${companyId}`, { method: 'POST' });
}

// ---- Reporte de nomina (Excel) ----

export function payrollReportUrl(companyId: string, from: string, to: string): string {
  return `${API_URL}/reports/payroll?companyId=${companyId}&from=${from}&to=${to}`;
}

export async function downloadPayrollReport(companyId: string, from: string, to: string) {
  const res = await apiFetch(`/reports/payroll?companyId=${companyId}&from=${from}&to=${to}`);
  if (!res.ok) throw new Error(`Error ${res.status} al generar el reporte`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `nomina_${from}_${to}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

// ---- Mi empresa / organizacion ----

export interface CompanyInfo {
  id: string;
  nit: string;
  legalName: string;
  tradeName: string | null;
  timezone: string;
}

export interface Department {
  id: string;
  name: string;
}

export interface WorkSite {
  id: string;
  name: string;
  address: string | null;
  latitude: string | null;
  longitude: string | null;
  gpsRadiusMeters: number;
}

export type DayOfWeek = 'MONDAY' | 'TUESDAY' | 'WEDNESDAY' | 'THURSDAY' | 'FRIDAY' | 'SATURDAY' | 'SUNDAY';

export interface ScheduleDetail {
  dayOfWeek: DayOfWeek;
  isWorkingDay: boolean;
  startTime: string | null;
  endTime: string | null;
  lunchMinutes: number | null;
}

export interface ScheduleSummary {
  id: string;
  name: string;
  weeklyHoursTarget?: string;
  defaultLunchMinutes?: number;
  lunchWindowStart?: string;
  lunchWindowEnd?: string;
  lunchToleranceMinutes?: number;
  finalExitWindowBeforeMin?: number;
  finalExitGraceMin?: number;
  details?: ScheduleDetail[];
}

export interface ScheduleDayInput {
  dayOfWeek: DayOfWeek;
  isWorkingDay: boolean;
  startTime?: string;
  endTime?: string;
  lunchMinutes?: number;
}

export interface Position {
  id: string;
  name: string;
  scheduleId: string | null;
  schedule: ScheduleSummary | null;
}

export function getMyCompany(): Promise<CompanyInfo> {
  return apiJson('/companies/me');
}

export function updateMyCompany(body: { legalName?: string; tradeName?: string }) {
  return apiJson('/companies/me', { method: 'PUT', body: JSON.stringify(body) });
}

export function getDepartments(): Promise<Department[]> {
  return apiJson('/companies/me/departments');
}

export function createDepartment(name: string): Promise<Department> {
  return apiJson('/companies/me/departments', { method: 'POST', body: JSON.stringify({ name }) });
}

export function getWorkSites(): Promise<WorkSite[]> {
  return apiJson('/companies/me/work-sites');
}

export function createWorkSite(body: {
  name: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  gpsRadiusMeters?: number;
}): Promise<WorkSite> {
  return apiJson('/companies/me/work-sites', { method: 'POST', body: JSON.stringify(body) });
}

export function updateWorkSite(
  id: string,
  body: Partial<{
    name: string;
    address: string;
    latitude: number;
    longitude: number;
    gpsRadiusMeters: number;
  }>,
): Promise<WorkSite> {
  return apiJson(`/companies/me/work-sites/${id}`, { method: 'PUT', body: JSON.stringify(body) });
}

export function getSchedules(): Promise<ScheduleSummary[]> {
  return apiJson('/companies/me/schedules');
}

export function createSchedule(body: {
  name: string;
  weeklyHoursTarget?: number;
  defaultLunchMinutes?: number;
  lunchWindowStart?: string;
  lunchWindowEnd?: string;
  lunchToleranceMinutes?: number;
  finalExitWindowBeforeMin?: number;
  finalExitGraceMin?: number;
  days: ScheduleDayInput[];
}): Promise<ScheduleSummary> {
  return apiJson('/companies/me/schedules', { method: 'POST', body: JSON.stringify(body) });
}

export function updateSchedule(
  id: string,
  body: Partial<{
    name: string;
    weeklyHoursTarget: number;
    defaultLunchMinutes: number;
    lunchWindowStart: string;
    lunchWindowEnd: string;
    lunchToleranceMinutes: number;
    finalExitWindowBeforeMin: number;
    finalExitGraceMin: number;
    days: ScheduleDayInput[];
  }>,
): Promise<ScheduleSummary> {
  return apiJson(`/companies/me/schedules/${id}`, { method: 'PUT', body: JSON.stringify(body) });
}

export function getPositions(): Promise<Position[]> {
  return apiJson('/companies/me/positions');
}

export function createPosition(body: { name: string; scheduleId?: string }): Promise<Position> {
  return apiJson('/companies/me/positions', { method: 'POST', body: JSON.stringify(body) });
}

export function updatePosition(id: string, body: Partial<{ name: string; scheduleId: string }>): Promise<Position> {
  return apiJson(`/companies/me/positions/${id}`, { method: 'PUT', body: JSON.stringify(body) });
}

// ---- Empleados ----

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
  position: Position | null;
}

export function getEmployees(): Promise<Employee[]> {
  return apiJson('/users');
}

export function createEmployee(body: {
  employeeCode: string;
  nationalId: string;
  fullName: string;
  email?: string;
  role?: string;
  departmentId?: string;
  workSiteId?: string;
  positionId?: string;
  scheduleId?: string;
  hireDate: string;
  baseSalary?: number;
  allowsLunchSkip?: boolean;
  password?: string;
  pin?: string;
}): Promise<Employee> {
  return apiJson('/users', { method: 'POST', body: JSON.stringify(body) });
}

export function updateEmployee(
  id: string,
  body: Partial<{
    fullName: string;
    email: string;
    role: string;
    departmentId: string;
    workSiteId: string;
    positionId: string;
    baseSalary: number;
    allowsLunchSkip: boolean;
    isActive: boolean;
    password: string;
    pin: string;
  }>,
) {
  return apiJson(`/users/${id}`, { method: 'PUT', body: JSON.stringify(body) });
}

export function deactivateEmployee(id: string) {
  return apiJson(`/users/${id}/deactivate`, { method: 'POST' });
}

// ---- Carga masiva de empleados (Excel) ----

export type ImportFieldMode = 'UNIFORM' | 'PER_ROW';

export interface BulkImportOptions {
  roleMode: ImportFieldMode;
  roleValue?: string;
  departmentMode: ImportFieldMode;
  departmentValue?: string;
  workSiteMode: ImportFieldMode;
  workSiteValue?: string;
}

export interface BulkImportRowResult {
  row: number;
  employeeCode?: string;
  status: 'created' | 'error';
  message?: string;
}

export interface BulkImportResult {
  created: number;
  errors: BulkImportRowResult[];
}

export async function downloadEmployeeImportTemplate(): Promise<Blob> {
  const res = await apiFetch('/users/import/template');
  if (!res.ok) throw new Error('No se pudo descargar la plantilla');
  return res.blob();
}

export async function bulkImportEmployees(file: File, options: BulkImportOptions): Promise<BulkImportResult> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('roleMode', options.roleMode);
  if (options.roleValue) formData.append('roleValue', options.roleValue);
  formData.append('departmentMode', options.departmentMode);
  if (options.departmentValue) formData.append('departmentValue', options.departmentValue);
  formData.append('workSiteMode', options.workSiteMode);
  if (options.workSiteValue) formData.append('workSiteValue', options.workSiteValue);

  const res = await apiFetch('/users/import', { method: 'POST', body: formData });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.message ?? `Error ${res.status} al importar`);
  }
  return res.json();
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

export function getTimeLogHistory(userId: string, from: string, to: string): Promise<TimeLogHistoryEntry[]> {
  return apiJson(`/time-logs/history?userId=${userId}&from=${from}&to=${to}`);
}

// ---- Reconocimiento facial ----
// El procesamiento de fotos ocurre enteramente en nuestro backend (face-api.js
// + tfjs-node); ninguna foto ni descriptor biometrico sale hacia un tercero.

export function enrollFace(body: { userId: string; imageBase64: string; consentText: string }) {
  return apiJson('/face/enroll', { method: 'POST', body: JSON.stringify(body) });
}

export function revokeFace(userId: string) {
  return apiJson(`/face/enroll/${userId}`, { method: 'DELETE' });
}

export function getFaceStatus(userId: string): Promise<{ enrolled: boolean; consentGivenAt: string | null }> {
  return apiJson(`/face/status/${userId}`);
}

export interface KioskFaceClockResult {
  fullName: string;
  employeeCode: string;
  logType: 'CHECK_IN' | 'LUNCH_OUT' | 'LUNCH_IN' | 'CHECK_OUT';
  loggedAt: string;
}

/** El kiosco no se autentica con ningun token: el backend identifica la sede (y la empresa) por la ubicacion GPS actual. */
export async function kioskFaceClock(latitude: number, longitude: number, imageBase64: string): Promise<KioskFaceClockResult> {
  const res = await fetch(`${API_URL}/kiosk/face-clock`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ latitude, longitude, imageBase64 }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.message ?? `Error ${res.status} al marcar`);
  }
  return res.json();
}

// ---- Calculo manual de nomina ----

export interface CalculatedNovelty {
  code: string;
  hours: number;
  status: string;
}

export interface DailyCalculationResult {
  userId: string;
  workDate: string;
  novelties: CalculatedNovelty[];
  totalOrdinaryHours: number;
  totalOvertimeHours: number;
  totalWorkedHours: number;
  hasPendingOvertime: boolean;
}

export interface ManualDayInput {
  userId: string;
  workDate: string;
  checkIn?: string;
  lunchOut?: string;
  lunchIn?: string;
  checkOut?: string;
}

/** Carga/reemplaza las marcas de un dia puntual y recalcula sus novedades (mismo motor que el kiosco). */
export function upsertManualDay(body: ManualDayInput): Promise<DailyCalculationResult> {
  return apiJson('/time-logs/manual', { method: 'PUT', body: JSON.stringify(body) });
}

export interface TimeLogMark {
  id: string;
  logType: 'CHECK_IN' | 'LUNCH_OUT' | 'LUNCH_IN' | 'CHECK_OUT';
  time: string;
  source: string;
}

export interface ManualDayExisting {
  workDate: string;
  checkIn?: string;
  lunchOut?: string;
  lunchIn?: string;
  checkOut?: string;
  marks: TimeLogMark[];
  novelties: CalculatedNovelty[];
  totalOrdinaryHours: number;
  totalOvertimeHours: number;
  totalWorkedHours: number;
}

/** Trae marcas/novedades ya cargadas de un empleado en un rango, para precargar el formulario. */
export function getManualRange(userId: string, from: string, to: string): Promise<ManualDayExisting[]> {
  return apiJson(`/time-logs/manual?userId=${userId}&from=${from}&to=${to}`);
}

export function deleteManualDay(userId: string, workDate: string): Promise<DailyCalculationResult> {
  return apiJson(`/time-logs/manual?userId=${userId}&workDate=${workDate}`, { method: 'DELETE' });
}

/** Cambia solo la hora de una marca puntual ya existente. */
export function updateMarkTime(id: string, time: string): Promise<DailyCalculationResult> {
  return apiJson(`/time-logs/${id}`, { method: 'PUT', body: JSON.stringify({ time }) });
}

/** Borra una marca puntual (no el dia completo). */
export function deleteMark(id: string): Promise<DailyCalculationResult> {
  return apiJson(`/time-logs/${id}`, { method: 'DELETE' });
}

/** Agrega una marca puntual nueva (ej. el empleado olvido marcar la salida). */
export function createMark(
  userId: string,
  workDate: string,
  logType: TimeLogMark['logType'],
  time: string,
): Promise<DailyCalculationResult> {
  return apiJson('/time-logs/manual-mark', { method: 'POST', body: JSON.stringify({ userId, workDate, logType, time }) });
}

// ---- Panel maestro (/master) ----
// Fuera del JWT normal: usa una contrasena separada (header x-master-password),
// asi que no reutiliza apiFetch/apiJson (esas redirigen a /login en un 401,
// lo cual no aplica aqui - una contrasena maestra invalida no es "tu sesion expiro").

async function masterJson<T>(path: string, masterPassword: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('x-master-password', masterPassword);
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const res = await fetch(`${API_URL}${path}`, { ...options, headers, cache: 'no-store' });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.message ?? `Error ${res.status}`);
  }
  return res.json();
}

export interface MasterStatus {
  companies: number;
  users: number;
  timeLogs: number;
}

export function getMasterStatus(masterPassword: string): Promise<MasterStatus> {
  return masterJson('/master/status', masterPassword);
}

export function resetDatabaseMaster(masterPassword: string, confirmationPhrase: string): Promise<{ success: boolean; message: string }> {
  return masterJson('/master/reset', masterPassword, { method: 'POST', body: JSON.stringify({ confirmationPhrase }) });
}

export interface BootstrapCompanyBody {
  legalName: string;
  nit: string;
  tradeName?: string;
  adminFullName: string;
  adminNationalId: string;
  adminEmail: string;
  adminPassword: string;
}

export function bootstrapCompanyMaster(
  masterPassword: string,
  body: BootstrapCompanyBody,
): Promise<{ company: { id: string; legalName: string }; admin: { id: string; email: string; employeeCode: string } }> {
  return masterJson('/master/bootstrap-company', masterPassword, { method: 'POST', body: JSON.stringify(body) });
}
