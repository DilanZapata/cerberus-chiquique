import { NoveltyCode, NoveltyOrigin, NoveltyStatus, TimeLogType } from './enums';

/** Marca de reloj (fichaje) normalizada, independiente del ORM. */
export interface TimeLogEntry {
  id?: string;
  userId: string;
  logType: TimeLogType;
  loggedAt: Date;
}

/** Parametros legales/configurables usados por el motor de calculo (packages/cst-rules). */
export interface PayrollConfigParams {
  /** Hora de inicio de la jornada diurna, formato "HH:mm". Default legal: 06:00 */
  dayStartTime: string;
  /** Hora de inicio de la jornada nocturna, formato "HH:mm". Default legal: 21:00 */
  nightStartTime: string;
  /** Tope de horas semanales vigente (Ley 2101 de 2021: 46/44/42 segun el ano). */
  maxWeeklyHours: number;
  /** Tope de horas ordinarias diarias antes de contar como extra. */
  maxDailyOrdinaryHours: number;
  /** Tope legal de horas extra diarias (Art. 22 Ley 50/1990 mod. Art. 13 Ley 2466/2025: 2h). */
  maxDailyOvertimeHours: number;
  /** Tope legal de horas extra semanales (12h). Debe cumplirse junto con el tope diario. */
  maxWeeklyOvertimeHours: number;
  /** Domingos/festivos trabajados por mes calendario hasta los cuales se considera "ocasional" (Art. 180 CST). Por encima es "habitual" y genera descanso compensatorio ademas del recargo. */
  dominicalOcasionalMaxPerMonth: number;
  /** Factores multiplicadores de recargo (porcentaje sobre el valor hora ordinaria). */
  pctRecargoNocturno: number;
  pctDominicalFestivo: number;
  pctDominicalFestivoNocturno: number;
  pctHoraExtraDiurna: number;
  pctHoraExtraNocturna: number;
  pctHoraExtraFestivaDiurna: number;
  pctHoraExtraFestivaNocturna: number;
  overtimeRequiresPreauthorization: boolean;
  overtimePendingAlertDays: number;
}

/** Configuracion de almuerzo de un horario/turno. */
export interface LunchPolicy {
  /** Duracion predeterminada del almuerzo en minutos si no hay marcas 2/3. */
  defaultLunchMinutes: number;
  /** Ventana en la que se permite iniciar el almuerzo, ej. 12:00 - 14:00. */
  windowStart: string;
  windowEnd: string;
  /** Minutos de tolerancia sobre el tiempo de almuerzo antes de marcar "llegada tarde". */
  toleranceMinutes: number;
  /** Si el empleado puede trabajar de corrido (sin marcar 2/3) y adelantar su salida. */
  allowsLunchSkip: boolean;
}

/** Turno/jornada programada para un dia especifico de un empleado. */
export interface PlannedShift {
  workDate: string; // YYYY-MM-DD
  plannedStart: Date;
  plannedEnd: Date;
  isRestDay: boolean;
  isHoliday: boolean; // domingo o festivo colombiano
  lunch: LunchPolicy;
}

/** Novedad calculada por el motor, previa a persistirse. */
export interface CalculatedNovelty {
  code: NoveltyCode;
  hours: number;
  status: NoveltyStatus;
  origin: NoveltyOrigin;
  notes?: string;
  sourceTimeLogId?: string;
}

/** Resultado completo del calculo de un dia para un empleado. */
export interface DailyCalculationResult {
  userId: string;
  workDate: string;
  novelties: CalculatedNovelty[];
  totalOrdinaryHours: number;
  totalOvertimeHours: number;
  totalWorkedHours: number;
  hasPendingOvertime: boolean;
}

/** Fila del reporte de nomina exportable a Excel (seccion 3 del brief). */
export interface PayrollReportRow {
  employeeCode: string;
  nationalId: string;
  fullName: string;
  RNO: number;
  DDCOF: number;
  DNCOF: number;
  HEOD: number;
  HEON: number;
  HEFD: number;
  HEFN: number;
  unauthorizedHours: number;
  totalWorkedHours: number;
  daysAbsent: number;
  daysPermission: number;
  daysSickLeave: number;
}
