import { TimeLogType } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { addDays, startOfLocalDay } from './time.util';

export const MARK_SEQUENCE: TimeLogType[] = [
  TimeLogType.CHECK_IN,
  TimeLogType.LUNCH_OUT,
  TimeLogType.LUNCH_IN,
  TimeLogType.CHECK_OUT,
];

// Ventanas por defecto (minutos), usadas solo cuando el horario resuelto no
// trae su propia configuracion (ej. turno de rutina rotativa sin Schedule
// propio, o sin horario asignado). Fase 4: el caso normal (Schedule via
// UserSchedule/Position) ya trae sus propios valores configurables -- ver
// MarkResolutionContext.finalExitWindowBeforeMin / nightShiftGraceMin.
const DEFAULT_FINAL_EXIT_WINDOW_BEFORE_MIN = 30;
const DEFAULT_NIGHT_SHIFT_GRACE_MIN = 240;

export interface ShiftMarks {
  checkIn?: Date;
  lunchOut?: Date;
  lunchIn?: Date;
  checkOut?: Date;
}

export interface PlannedShiftWindow {
  start: Date;
  end: Date;
}

/**
 * Contexto de horario que el llamador (kiosco / app movil) debe resolver
 * ANTES de invocar resolveNextMark, via NoveltiesService.resolveMarkContext
 * -- la misma resolucion de horario (Shift > UserSchedule > Position.schedule)
 * que ya usa el motor de novedades para calcular RNO/HEOD/etc, para que la
 * INTERPRETACION de una marca y el CALCULO de nomina nunca queden
 * desincronizados entre si.
 */
export interface MarkResolutionContext {
  /** Horario planeado para el dia calendario de "now". Undefined si no tiene horario asignado ese dia (o es dia de descanso). */
  todayPlannedShift?: PlannedShiftWindow;
  /** Horario planeado para el dia calendario ANTERIOR a "now" -- para decidir si un turno de ayer cruzaba la medianoche. */
  yesterdayPlannedShift?: PlannedShiftWindow;
  allowsLunchSkip: boolean;
  defaultLunchMinutes: number;
  /** Ventanas configurables del Schedule resuelto (Fase 4). Undefined -> se usan los defaults de este archivo. */
  finalExitWindowBeforeMin?: number;
  finalExitGraceMin?: number;
  /**
   * Ventana de almuerzo configurada ("HH:mm" + tolerancia en minutos),
   * misma que usa el motor de nomina (resolveLunch en cst-rules) para
   * decidir si un hueco sin marcar es almuerzo. Sin esto, una marca
   * cualquiera despues del check-in se asignaria ciegamente al siguiente
   * slot vacio (LUNCH_OUT) sin importar si la hora tiene algo que ver con
   * el horario real de almuerzo -- ver decideForOpenShift.
   */
  lunchWindowStart?: string;
  lunchWindowEnd?: string;
  lunchToleranceMinutes?: number;
}

export interface ResolvedMark {
  nextLogType: TimeLogType;
  workDate: string;
  /** Explica por que se tomo esta decision (requisito: la logica debe ser explicable, no una caja negra). */
  reason: string;
}

function markValue(marks: ShiftMarks, type: TimeLogType): Date | undefined {
  if (type === TimeLogType.CHECK_IN) return marks.checkIn;
  if (type === TimeLogType.LUNCH_OUT) return marks.lunchOut;
  if (type === TimeLogType.LUNCH_IN) return marks.lunchIn;
  return marks.checkOut;
}

/** Un turno "cruza medianoche" si su hora de salida (de reloj) es anterior a su hora de entrada (ej. 22:00 -> 06:00). */
function crossesMidnight(shift: PlannedShiftWindow): boolean {
  const startMinutes = shift.start.getHours() * 60 + shift.start.getMinutes();
  const endMinutes = shift.end.getHours() * 60 + shift.end.getMinutes();
  return endMinutes < startMinutes;
}

function timeOnDate(referenceDate: Date, hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(referenceDate);
  d.setHours(h, m, 0, 0);
  return d;
}

/**
 * Determina si `now` cae dentro de la ventana de almuerzo configurada (con
 * tolerancia), anclada al dia de `checkIn` -- mismo criterio que usa
 * `resolveLunch()` en `cst-rules/lunch-engine.ts` para decidir donde cae el
 * almuerzo cuando no se marco, para que la INTERPRETACION de una marca y el
 * CALCULO de nomina compartan la misma nocion de "esto es horario de
 * almuerzo". Si la hora de la ventana en reloj cae antes que `checkIn` (ej.
 * turno nocturno 10pm-6am con ventana 12:00-13:00), se prueba la instancia
 * del dia calendario siguiente.
 */
function isWithinLunchWindow(checkIn: Date, now: Date, windowStart: string, windowEnd: string, toleranceMinutes: number): boolean {
  const candidateStart = timeOnDate(checkIn, windowStart);
  const start = candidateStart >= checkIn ? candidateStart : addDays(candidateStart, 1);
  let end = timeOnDate(start, windowEnd);
  if (end < start) end = addDays(end, 1); // ventana que cruza medianoche

  const toleratedStart = new Date(start.getTime() - toleranceMinutes * 60_000);
  const toleratedEnd = new Date(end.getTime() + toleranceMinutes * 60_000);
  return now >= toleratedStart && now <= toleratedEnd;
}

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Encuentra las marcas del turno que inicia en `date`, buscando la salida (y
 * las de almuerzo) en orden cronologico en vez de por dia calendario, para
 * soportar turnos que cruzan la medianoche (ej. vigilantes 10pm-6am). Se
 * acota a la proxima entrada (inicio de otro turno) si aparece antes, y a un
 * maximo de 24h desde la entrada como limite de seguridad.
 */
export async function findShiftMarks(prisma: PrismaService, userId: string, date: Date): Promise<ShiftMarks> {
  const dayEnd = addDays(date, 1);
  const checkInLog = await prisma.timeLog.findFirst({
    where: { userId, logType: TimeLogType.CHECK_IN, loggedAt: { gte: date, lt: dayEnd } },
    orderBy: { loggedAt: 'asc' },
  });
  if (!checkInLog) return {};

  const searchEnd = addDays(checkInLog.loggedAt, 1);
  const nextCheckIn = await prisma.timeLog.findFirst({
    where: { userId, logType: TimeLogType.CHECK_IN, loggedAt: { gt: checkInLog.loggedAt, lt: searchEnd } },
    orderBy: { loggedAt: 'asc' },
  });
  const boundary = nextCheckIn?.loggedAt ?? searchEnd;

  const subsequent = await prisma.timeLog.findMany({
    where: { userId, loggedAt: { gt: checkInLog.loggedAt, lt: boundary } },
    orderBy: { loggedAt: 'asc' },
  });

  const byType = (type: TimeLogType) => subsequent.find((l) => l.logType === type)?.loggedAt;

  return {
    checkIn: checkInLog.loggedAt,
    lunchOut: byType(TimeLogType.LUNCH_OUT),
    lunchIn: byType(TimeLogType.LUNCH_IN),
    checkOut: byType(TimeLogType.CHECK_OUT),
  };
}

/**
 * Determina la siguiente marca esperada (kiosco/app) para un empleado en el
 * instante `now`, usando el horario REAL asignado (context) en vez de
 * asumir ciegamente "el siguiente slot vacio de la secuencia".
 *
 * Dos reglas nuevas que corrigen el bug original:
 *
 * 1. Una marca de un dia nuevo NUNCA completa el turno de ayer, salvo que el
 *    horario de ayer cruzara realmente la medianoche (turnos nocturnos tipo
 *    vigilante) -- y aun asi, acotado al fin real de ese turno + un margen
 *    de gracia, no a una ventana ciega de 24h.
 * 2. Si la hora actual esta cerca o despues de la hora de salida programada
 *    (o de la salida programada MENOS el almuerzo, si el empleado tiene
 *    permiso de saltarlo y aun no marco ningun evento de almuerzo -- el
 *    caso de "adelanto/compensacion de almuerzo"), la marca SIEMPRE se
 *    interpreta como salida final, incluso si faltaron marcas de almuerzo.
 */
/**
 * Decide la siguiente marca para un turno YA con entrada marcada (hoy, o el
 * de ayer si se esta continuando un turno nocturno). Centraliza la regla de
 * "cerca o despues de la salida final = siempre salida definitiva" para que
 * aplique por igual a ambos casos -- antes solo se aplicaba al turno de hoy,
 * dejando turnos nocturnos sin marca de almuerzo con el mismo bug original.
 */
function decideForOpenShift(
  marks: ShiftMarks,
  plannedShift: PlannedShiftWindow | undefined,
  allowsLunchSkip: boolean,
  defaultLunchMinutes: number,
  now: Date,
  workDate: string,
  finalExitWindowBeforeMin: number,
  lunchWindow: { start: string; end: string; toleranceMinutes: number } | undefined,
): ResolvedMark | null {
  if (marks.checkOut) return null; // ya completo las marcas de ese turno

  if (plannedShift) {
    let effectiveFinalExit = plannedShift.end;
    let compensating = false;
    if (allowsLunchSkip && !marks.lunchOut && !marks.lunchIn) {
      // Permiso de saltar almuerzo y aun no marco nada de almuerzo: si sale
      // ahora, esta compensando/adelantando el almuerzo, asi que su salida
      // "normal" efectiva es la hora programada MENOS el almuerzo.
      effectiveFinalExit = new Date(effectiveFinalExit.getTime() - defaultLunchMinutes * 60_000);
      compensating = true;
    }
    const windowStart = new Date(effectiveFinalExit.getTime() - finalExitWindowBeforeMin * 60_000);
    if (now >= windowStart) {
      return {
        nextLogType: TimeLogType.CHECK_OUT,
        workDate,
        reason: compensating
          ? 'Dentro de la ventana de salida final compensando/adelantando el almuerzo (tiene permiso de saltarlo y no lo marco); se registra como salida definitiva.'
          : `Dentro de la ventana de salida final (${finalExitWindowBeforeMin} min antes de la hora programada, o despues); se registra como salida definitiva aunque falten marcas de almuerzo.`,
      };
    }
  }

  // Si todavia no hay NINGUNA marca de almuerzo y "now" cae claramente
  // fuera de la ventana de almuerzo configurada (con tolerancia), esta
  // marca NO es un almuerzo -- es una salida definitiva anticipada (ej.
  // alguien que entro a las 8am y marca de nuevo a las 4pm, con horario de
  // almuerzo 12pm-2pm). Sin este chequeo, CUALQUIER marca posterior al
  // check-in se asignaba ciegamente al siguiente slot vacio (LUNCH_OUT) sin
  // importar que tan lejos estuviera del horario real de almuerzo -- lo que
  // ademas corrompia el calculo de nomina (resolveLunch interpretaria luego
  // eso como abandono de almuerzo, no como una jornada corta legitima).
  if (!marks.lunchOut && !marks.lunchIn && marks.checkIn && lunchWindow) {
    const withinLunchWindow = isWithinLunchWindow(marks.checkIn, now, lunchWindow.start, lunchWindow.end, lunchWindow.toleranceMinutes);
    if (!withinLunchWindow) {
      return {
        nextLogType: TimeLogType.CHECK_OUT,
        workDate,
        reason: `Fuera de la ventana de almuerzo configurada (${lunchWindow.start}-${lunchWindow.end}, tolerancia ${lunchWindow.toleranceMinutes} min); se interpreta como salida definitiva anticipada, no como salida a almuerzo.`,
      };
    }
  }

  const nextType = MARK_SEQUENCE.find((type) => !markValue(marks, type));
  if (!nextType) return null;
  return { nextLogType: nextType, workDate, reason: 'Siguiente marca en la secuencia normal del turno (aun lejos de la salida final programada).' };
}

export async function resolveNextMark(
  prisma: PrismaService,
  userId: string,
  now: Date,
  context: MarkResolutionContext,
): Promise<ResolvedMark | null> {
  const today = startOfLocalDay(now);
  const todayMarks = await findShiftMarks(prisma, userId, today);
  const finalExitWindowBeforeMin = context.finalExitWindowBeforeMin ?? DEFAULT_FINAL_EXIT_WINDOW_BEFORE_MIN;
  const nightShiftGraceMin = context.finalExitGraceMin ?? DEFAULT_NIGHT_SHIFT_GRACE_MIN;
  const lunchWindow =
    context.lunchWindowStart && context.lunchWindowEnd
      ? { start: context.lunchWindowStart, end: context.lunchWindowEnd, toleranceMinutes: context.lunchToleranceMinutes ?? 0 }
      : undefined;

  if (!todayMarks.checkIn) {
    // Sin entrada hoy. Solo se considera "continuar" el turno de ayer si ese
    // turno realmente cruzaba la medianoche segun el horario asignado --
    // nunca por defecto, y nunca para personal con horario diurno normal.
    if (context.yesterdayPlannedShift && crossesMidnight(context.yesterdayPlannedShift)) {
      const yesterday = addDays(today, -1);
      const yesterdayMarks = await findShiftMarks(prisma, userId, yesterday);
      const graceEnd = new Date(context.yesterdayPlannedShift.end.getTime() + nightShiftGraceMin * 60_000);
      if (yesterdayMarks.checkIn && now <= graceEnd) {
        const decided = decideForOpenShift(
          yesterdayMarks,
          context.yesterdayPlannedShift,
          context.allowsLunchSkip,
          context.defaultLunchMinutes,
          now,
          dateKey(yesterday),
          finalExitWindowBeforeMin,
          lunchWindow,
        );
        if (decided) {
          return {
            ...decided,
            reason: `Continua el turno nocturno de ayer (horario cruza medianoche, dentro del margen de ${nightShiftGraceMin} min tras su salida programada). ${decided.reason}`,
          };
        }
      }
    }
    return { nextLogType: TimeLogType.CHECK_IN, workDate: dateKey(today), reason: 'Primera marca del dia calendario de hoy.' };
  }

  return decideForOpenShift(
    todayMarks,
    context.todayPlannedShift,
    context.allowsLunchSkip,
    context.defaultLunchMinutes,
    now,
    dateKey(today),
    finalExitWindowBeforeMin,
    lunchWindow,
  );
}
