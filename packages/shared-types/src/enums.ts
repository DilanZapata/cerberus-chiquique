// Enums compartidos entre backend (NestJS), web (Next.js) y movil (Expo).
// Deben permanecer sincronizados con apps/api/prisma/schema.prisma.

export enum TimeLogType {
  CHECK_IN = 'CHECK_IN', // Marca 1: Entrada inicial
  LUNCH_OUT = 'LUNCH_OUT', // Marca 2: Salida a almuerzo
  LUNCH_IN = 'LUNCH_IN', // Marca 3: Reingreso de almuerzo
  CHECK_OUT = 'CHECK_OUT', // Marca 4: Salida final
}

export enum TimeLogSource {
  KIOSK = 'KIOSK',
  MOBILE_GPS = 'MOBILE_GPS',
  WEB = 'WEB',
  MANUAL = 'MANUAL',
}

export enum ShiftRotation {
  DIURNO = 'DIURNO',
  NOCTURNO = 'NOCTURNO',
  MIXTO = 'MIXTO',
  DESCANSO = 'DESCANSO',
}

// Catalogo legal de conceptos CST Colombia (tambien columnas del reporte de nomina)
export enum NoveltyCode {
  RNO = 'RNO', // Recargo Nocturno Ordinario
  DDCOF = 'DDCOF', // Dominical / Festivo Ordinario (diurno)
  DNCOF = 'DNCOF', // Dominical / Festivo Nocturno
  HEOD = 'HEOD', // Hora Extra Ordinaria Diurna
  HEON = 'HEON', // Hora Extra Ordinaria Nocturna
  HEFD = 'HEFD', // Hora Extra Festiva/Dominical Diurna
  HEFN = 'HEFN', // Hora Extra Festiva/Dominical Nocturna
  LLEGADA_TARDE = 'LLEGADA_TARDE',
  LLEGADA_TARDE_ALMUERZO = 'LLEGADA_TARDE_ALMUERZO',
  ABANDONO_ALMUERZO = 'ABANDONO_ALMUERZO',
  SALIDA_ANTICIPADA = 'SALIDA_ANTICIPADA',
  AUSENCIA_INJUSTIFICADA = 'AUSENCIA_INJUSTIFICADA',
  PERMISO_REMUNERADO = 'PERMISO_REMUNERADO',
  PERMISO_NO_REMUNERADO = 'PERMISO_NO_REMUNERADO',
  PERMISO_SALIDA_TEMPORAL = 'PERMISO_SALIDA_TEMPORAL',
  INCAPACIDAD_GENERAL = 'INCAPACIDAD_GENERAL',
  INCAPACIDAD_ARL = 'INCAPACIDAD_ARL',
  VACACIONES = 'VACACIONES',
  HORA_EXTRA_PENDIENTE = 'HORA_EXTRA_PENDIENTE',
  // Credito de descanso compensatorio pendiente por domingo/festivo habitual (Art. 180 CST).
  DESCANSO_COMPENSATORIO_PENDIENTE = 'DESCANSO_COMPENSATORIO_PENDIENTE',
  // Alerta de cumplimiento: se supero el tope legal de horas extra (2h/dia o 12h/semana).
  LIMITE_HORAS_EXTRA_EXCEDIDO = 'LIMITE_HORAS_EXTRA_EXCEDIDO',
}

// Codigos que van como columnas acumulativas en el reporte de nomina (seccion 3 del brief)
export const PAYROLL_REPORT_NOVELTY_CODES = [
  NoveltyCode.RNO,
  NoveltyCode.DDCOF,
  NoveltyCode.DNCOF,
  NoveltyCode.HEOD,
  NoveltyCode.HEON,
  NoveltyCode.HEFD,
  NoveltyCode.HEFN,
] as const;

export enum NoveltyStatus {
  PENDIENTE = 'PENDIENTE',
  APROBADA = 'APROBADA',
  RECHAZADA = 'RECHAZADA',
  AUTO_CALCULADA = 'AUTO_CALCULADA',
}

export enum NoveltyOrigin {
  SISTEMA = 'SISTEMA',
  MANUAL = 'MANUAL',
  IMPORTADO = 'IMPORTADO',
}

export enum UserRole {
  ADMIN = 'ADMIN',
  HR = 'HR',
  SUPERVISOR = 'SUPERVISOR',
  EMPLOYEE = 'EMPLOYEE',
}
