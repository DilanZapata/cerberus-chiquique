import { NoveltyCode, NoveltyStatus, Prisma, TimeLogSource, TimeLogType } from '@prisma/client';
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

// Margen minimo (minutos) desde el check-in antes de que el heuristico de
// "fuera de la ventana de almuerzo = salida definitiva anticipada" (ver
// decideForOpenShift mas abajo) pueda aplicar. Sin este margen, una segunda
// captura a los pocos segundos/minutos del ingreso (ej. el kiosco facial
// re-detectando el mismo rostro mientras la persona sigue en el sitio) se
// interpretaba como la salida final del dia -- bloqueando el resto de sus
// marcas reales de ese dia ("ya completaste las 4 marcas de hoy", sin que la
// persona se hubiera ido). Corrige el hallazgo prioritario de la auditoria
// de asistencia del 2026-10-16 (seccion E: causa raiz del bug "4 marcas").
const MIN_MINUTES_SINCE_CHECK_IN_FOR_EARLY_EXIT = 60;

// Una marca repetida NO debe avanzar la secuencia del dia. Si alguien marca
// la entrada y "por si acaso" vuelve a marcar unos minutos despues, esa
// segunda marca antes se guardaba como salida a almuerzo; el almuerzo real
// quedaba como reingreso, el reingreso como SALIDA, y al final de la jornada
// el kiosco respondia "ya se registro tu salida" sin que la persona se
// hubiera ido. Estas ventanas detectan la repeticion y la rechazan con un
// mensaje claro, sin guardar nada:
//  - cualquier marca a menos de MIN_MINUTES_BETWEEN_MARKS de la anterior;
//  - una "salida" a menos de MIN_MINUTES_SINCE_CHECK_IN_FOR_EARLY_EXIT de
//    haber entrado, fuera del horario de almuerzo y de la hora de salida;
//  - una "salida a almuerzo" a menos de MIN_MINUTES_SINCE_CHECK_IN_FOR_LUNCH
//    de haber entrado (nadie sale a almorzar recien llega);
//  - una "salida" a menos de MIN_MINUTES_SINCE_LUNCH_IN_FOR_EXIT de haber
//    vuelto de almuerzo.
const MIN_MINUTES_BETWEEN_MARKS = 15;
const MIN_MINUTES_SINCE_CHECK_IN_FOR_LUNCH = 30;
const MIN_MINUTES_SINCE_LUNCH_IN_FOR_EXIT = 30;

// Una salida ANTICIPADA (antes de la hora de salida del horario) nunca deja
// el dia bloqueado: si la persona vuelve a marcar, es que sigue (o volvio) al
// trabajo. Ver decideForClosedShift. Si ya habia marcado almuerzo, la marca
// nueva reemplaza esa salida, pero solo pasado este tiempo -- antes de eso es
// la misma salida marcada otra vez.
const MIN_MINUTES_TO_REPLACE_EARLY_EXIT = 60;

// Una marca alrededor de la hora de inicio del turno, de alguien que ya habia
// marcado la entrada antes (llego temprano y "vuelve a marcar cuando empieza
// el turno"), es la entrada repetida, no una salida.
const ENTRY_REPEAT_AROUND_SHIFT_START_MIN = 30;

// Turno nocturno ya cerrado (o sin entrada marcada): una marca en la manana
// se toma como la salida de anoche, y no como la entrada de hoy, mientras al
// turno de hoy le falte mas de este tiempo para empezar.
const MIN_MINUTES_BEFORE_NEXT_SHIFT_START = 120;

const MARK_NAMES: Record<TimeLogType, string> = {
  [TimeLogType.CHECK_IN]: 'tu entrada',
  [TimeLogType.LUNCH_OUT]: 'tu salida a almuerzo',
  [TimeLogType.LUNCH_IN]: 'tu reingreso de almuerzo',
  [TimeLogType.CHECK_OUT]: 'tu salida',
};

function hhmmOf(date: Date): string {
  return date.toTimeString().slice(0, 5);
}

/** La marca se rechaza por ser una repeticion de la anterior (no se guarda nada). */
export interface RepeatedMark {
  repeated: true;
  /** Mensaje para la persona, listo para mostrar en el kiosco. */
  message: string;
}

export function isRepeatedMark(result: ResolvedMark | RepeatedMark): result is RepeatedMark {
  return 'repeated' in result;
}

function repeatedMark(type: TimeLogType, at: Date, hint: string): RepeatedMark {
  return { repeated: true, message: `Ya registraste ${MARK_NAMES[type]} a las ${hhmmOf(at)}. ${hint}` };
}

export interface ShiftMarks {
  checkIn?: Date;
  lunchOut?: Date;
  lunchIn?: Date;
  checkOut?: Date;
  /** Fila de la salida, para poder corregirla si la persona vuelve a marcar (ver MarkAmendment). */
  checkOutLogId?: string;
  /** AUTO_CLOSE = la salida la puso el cierre automatico, no la persona. */
  checkOutSource?: TimeLogSource;
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
  /** La pausa del dia es el descanso largo entre dos bloques (turno partido por la medianoche), no un almuerzo. */
  breakIsRest?: boolean;
  /** Bloques de trabajo del dia cuando viene partido por la medianoche (1 o 2). Undefined en un dia normal. */
  dayBlocks?: PlannedShiftWindow[];
  /** El primer bloque arranca a las 00:00 porque es la continuacion del turno de anoche. */
  continuesFromYesterday?: boolean;
  /** Rangos en que antes se marcaba la comida del turno de noche: ya no se marca, se descuenta sola. */
  mealWindows?: PlannedShiftWindow[];
}

/**
 * Correccion a una salida ya guardada, que debe aplicarse junto con la marca
 * nueva (ver persistResolvedMark):
 *  - RETYPE_EXIT_AS_LUNCH_OUT: la persona marco "salida" antes de hora y luego
 *    volvio a marcar -> esa salida era en realidad la salida a un descanso;
 *    pasa a ser LUNCH_OUT y la marca nueva se crea normalmente.
 *  - REPLACE_EXIT: la marca nueva ES la salida real del dia; reemplaza la que
 *    habia (la del cierre automatico, o una salida anticipada que no fue la
 *    definitiva). No se crea una fila nueva: se actualiza la existente.
 * En ambos casos queda rastro en audit_log.
 */
export type MarkAmendment =
  | { kind: 'RETYPE_EXIT_AS_LUNCH_OUT'; logId: string }
  | { kind: 'REPLACE_EXIT'; logId: string; wasAutoClose: boolean };

export interface ResolvedMark {
  nextLogType: TimeLogType;
  workDate: string;
  /** Explica por que se tomo esta decision (requisito: la logica debe ser explicable, no una caja negra). */
  reason: string;
  amend?: MarkAmendment;
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
 * Ventana de almuerzo configurada (sin tolerancia) que le corresponde al turno
 * que empezo en `checkIn` -- mismo criterio que usa `resolveLunch()` en
 * `cst-rules/lunch-engine.ts`, para que la INTERPRETACION de una marca y el
 * CALCULO de nomina compartan la misma nocion de "horario de almuerzo".
 * Es la del mismo dia de la entrada, salvo que la entrada haya sido despues
 * de que esa ventana ya cerro (ej. turno nocturno 10pm-6am con ventana
 * 12:00-13:00): ahi es la del dia siguiente. Quien entra DENTRO de la ventana
 * (llego a las 12:05) sigue estando en la ventana de ese mismo dia.
 */
function lunchWindowFor(checkIn: Date, windowStart: string, windowEnd: string, toleranceMinutes: number): { start: Date; end: Date } {
  let start = timeOnDate(checkIn, windowStart);
  let end = timeOnDate(start, windowEnd);
  if (end < start) end = addDays(end, 1); // ventana que cruza medianoche
  if (checkIn.getTime() > end.getTime() + toleranceMinutes * 60_000) {
    start = addDays(start, 1);
    end = addDays(end, 1);
  }
  return { start, end };
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

  const checkOutLog = subsequent.find((l) => l.logType === TimeLogType.CHECK_OUT);
  // Una marca de pausa posterior a la salida ya no es de esta jornada (ej. la
  // "salida a descanso" de la manana siguiente): no se le pega a este dia.
  const byType = (type: TimeLogType) =>
    subsequent.find((l) => l.logType === type && (!checkOutLog || l.loggedAt < checkOutLog.loggedAt))?.loggedAt;

  // Corte de medianoche sin salida guardada: si a las 00:00 del dia siguiente
  // el sistema le puso la entrada automatica, es que la persona seguia
  // trabajando a medianoche, asi que este dia termino a las 23:59:59 aunque
  // no exista esa fila. Pasa el PRIMER dia del manejo por dia calendario a
  // quien venia de un turno de noche: ese dia ya tiene la salida de la manana
  // (del turno de la noche anterior) y la base no admite una segunda salida
  // el mismo dia.
  if (!checkOutLog) {
    const midnight = addDays(startOfLocalDay(checkInLog.loggedAt), 1);
    const handover = await prisma.timeLog.findFirst({
      where: { userId, logType: TimeLogType.CHECK_IN, source: TimeLogSource.AUTO_MIDNIGHT, loggedAt: midnight },
      select: { id: true },
    });
    const stillInside = !subsequent.some((l) => l.logType === TimeLogType.LUNCH_OUT) || subsequent.some((l) => l.logType === TimeLogType.LUNCH_IN);
    if (handover && stillInside) {
      return {
        checkIn: checkInLog.loggedAt,
        lunchOut: byType(TimeLogType.LUNCH_OUT),
        lunchIn: byType(TimeLogType.LUNCH_IN),
        checkOut: new Date(midnight.getTime() - 1000),
        checkOutSource: TimeLogSource.AUTO_MIDNIGHT,
      };
    }
  }

  return {
    checkIn: checkInLog.loggedAt,
    lunchOut: byType(TimeLogType.LUNCH_OUT),
    lunchIn: byType(TimeLogType.LUNCH_IN),
    checkOut: checkOutLog?.loggedAt,
    checkOutLogId: checkOutLog?.id,
    checkOutSource: checkOutLog?.source,
  };
}

/**
 * Mensaje para un turno ya cerrado. Describe lo que el sistema realmente
 * sabe -- la hora de la salida ya registrada -- en vez de asumir "ya
 * completaste las 4 marcas" (hallazgo E / P3 #15 de la auditoria 2026-10-16).
 */
export function describeClosedShift(marks: ShiftMarks): string {
  if (marks.checkOut) {
    return `Ya se registro tu salida, a las ${hhmmOf(marks.checkOut)}. Si fue un error, pide a un supervisor o a RH que la corrija.`;
  }
  return 'Ya completaste tus marcas de hoy.';
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
): ResolvedMark | RepeatedMark | null {
  if (!marks.checkIn) return null;

  const hasLunchMarks = Boolean(marks.lunchOut || marks.lunchIn);
  // Permiso de saltar almuerzo y aun no marco nada de almuerzo: si sale
  // ahora, esta compensando/adelantando el almuerzo, asi que su salida
  // "normal" efectiva es la hora programada MENOS el almuerzo.
  const compensating = Boolean(plannedShift) && allowsLunchSkip && !hasLunchMarks;
  // Desde esta hora, una marca es "la salida del dia" segun el horario.
  const finalExitWindowStart = plannedShift
    ? new Date(plannedShift.end.getTime() - ((compensating ? defaultLunchMinutes : 0) + finalExitWindowBeforeMin) * 60_000)
    : undefined;

  if (marks.checkOut) {
    return decideForClosedShift(marks, plannedShift, now, workDate, finalExitWindowBeforeMin, finalExitWindowStart);
  }

  // Ultima marca del turno abierto: si esta es casi inmediata, es la misma
  // persona marcando otra vez, no un evento nuevo del dia.
  const lastMark: { type: TimeLogType; at: Date } = marks.lunchIn
    ? { type: TimeLogType.LUNCH_IN, at: marks.lunchIn }
    : marks.lunchOut
      ? { type: TimeLogType.LUNCH_OUT, at: marks.lunchOut }
      : { type: TimeLogType.CHECK_IN, at: marks.checkIn };
  const minutesSinceLastMark = (now.getTime() - lastMark.at.getTime()) / 60_000;
  if (minutesSinceLastMark < MIN_MINUTES_BETWEEN_MARKS) {
    return repeatedMark(
      lastMark.type,
      lastMark.at,
      lastMark.type === TimeLogType.LUNCH_OUT ? 'Vuelve a marcar cuando regreses.' : 'No hace falta marcar de nuevo.',
    );
  }

  if (finalExitWindowStart && now >= finalExitWindowStart) {
    return {
      nextLogType: TimeLogType.CHECK_OUT,
      workDate,
      reason: compensating
        ? 'Dentro de la ventana de salida final compensando/adelantando el almuerzo (tiene permiso de saltarlo y no lo marco); se registra como salida definitiva.'
        : `Dentro de la ventana de salida final (${finalExitWindowBeforeMin} min antes de la hora programada, o despues); se registra como salida definitiva aunque falten marcas de almuerzo.`,
    };
  }

  // Llego antes de su hora y vuelve a marcar "cuando empieza el turno": es la
  // entrada otra vez. (Antes se guardaba como salida anticipada y le cerraba
  // el dia a la hora de entrar.)
  if (
    plannedShift &&
    !hasLunchMarks &&
    marks.checkIn < plannedShift.start &&
    Math.abs(now.getTime() - plannedShift.start.getTime()) <= ENTRY_REPEAT_AROUND_SHIFT_START_MIN * 60_000
  ) {
    return repeatedMark(TimeLogType.CHECK_IN, marks.checkIn, 'No hace falta marcar de nuevo.');
  }

  // Todavia no hay NINGUNA marca de almuerzo: la hora decide si esta marca es
  // la salida a almorzar o una salida anticipada (ej. alguien que entro a las
  // 8am y marca de nuevo a las 4pm, con almuerzo de 12 a 2). Sin este chequeo,
  // CUALQUIER marca posterior a la entrada se asignaba al siguiente slot vacio
  // (LUNCH_OUT) sin importar la hora.
  if (!hasLunchMarks && lunchWindow) {
    const window = lunchWindowFor(marks.checkIn, lunchWindow.start, lunchWindow.end, lunchWindow.toleranceMinutes);
    const toleranceMs = lunchWindow.toleranceMinutes * 60_000;
    // Si el turno termina antes de que quepa un almuerzo (ej. sabado de medio
    // dia 6-12 con almuerzo de 11:30 a 1), ese dia no hay almuerzo: una marca
    // a las 11:20 es que se va, no que sale a almorzar.
    const lunchFitsInShift = !plannedShift || plannedShift.end.getTime() > window.start.getTime() + defaultLunchMinutes * 60_000;
    const withinLunchWindow =
      lunchFitsInShift && now.getTime() >= window.start.getTime() - toleranceMs && now.getTime() <= window.end.getTime() + toleranceMs;
    const minutesSinceCheckIn = (now.getTime() - marks.checkIn.getTime()) / 60_000;

    if (!withinLunchWindow) {
      if (minutesSinceCheckIn >= MIN_MINUTES_SINCE_CHECK_IN_FOR_EARLY_EXIT) {
        return {
          nextLogType: TimeLogType.CHECK_OUT,
          workDate,
          reason: `Fuera del horario de almuerzo configurado (${lunchWindow.start}-${lunchWindow.end}, tolerancia ${lunchWindow.toleranceMinutes} min); se registra como salida anticipada. Si la persona vuelve a marcar hoy, se corrige a salida a descanso (ver decideForClosedShift).`,
        };
      }
      // Ni es hora de almuerzo ni ha pasado una hora desde la entrada: no es
      // un almuerzo ni una salida creible, es la entrada marcada otra vez.
      return repeatedMark(TimeLogType.CHECK_IN, marks.checkIn, 'No hace falta marcar de nuevo.');
    }
    if (minutesSinceCheckIn < MIN_MINUTES_SINCE_CHECK_IN_FOR_LUNCH) {
      // Es hora de almuerzo, pero acaba de llegar: es la entrada repetida.
      return repeatedMark(TimeLogType.CHECK_IN, marks.checkIn, 'No hace falta marcar de nuevo.');
    }
  }

  // Ya volvio de almuerzo: lo unico que queda por marcar es la salida. A los
  // pocos minutos de haber vuelto es el reingreso marcado otra vez.
  if (marks.lunchIn && minutesSinceLastMark < MIN_MINUTES_SINCE_LUNCH_IN_FOR_EXIT) {
    return repeatedMark(TimeLogType.LUNCH_IN, marks.lunchIn, 'No hace falta marcar de nuevo.');
  }

  const nextType = MARK_SEQUENCE.find((type) => !markValue(marks, type));
  if (!nextType) return null;
  return { nextLogType: nextType, workDate, reason: 'Siguiente marca en la secuencia normal del turno (aun lejos de la salida final programada).' };
}

/**
 * El turno ya tiene salida y la persona vuelve a marcar. Que la persona este
 * marcando (en el sitio, con foto) es evidencia de que NO se habia ido del
 * todo, asi que una salida que no fue la del final de la jornada nunca debe
 * dejarle el dia bloqueado -- ese era el origen de "ya se registraron mis
 * marcas" cuando alguien salia a almorzar fuera de hora, salia a una vuelta o
 * marcaba de mas a media manana:
 *
 *  - La salida la puso el cierre automatico (la persona no la habia marcado):
 *    esta marca es su salida real y reemplaza la automatica (ej. se quedo en
 *    hora extra hasta despues del cierre).
 *  - La salida fue ANTICIPADA (antes de la hora de salida del horario):
 *      · sin marcas de almuerzo -> esa "salida" era la salida a un descanso
 *        (almuerzo temprano o tarde, una cita, una vuelta). Se corrige a
 *        salida a almuerzo y esta marca es el regreso (o la salida del dia,
 *        si ya es hora de salir).
 *      · con almuerzo ya marcado -> esta marca es la salida real del dia y
 *        reemplaza la anterior.
 *  - La salida fue a su hora normal: el turno si esta cerrado; se rechaza
 *    diciendole a que hora quedo su salida.
 */
function decideForClosedShift(
  marks: ShiftMarks,
  plannedShift: PlannedShiftWindow | undefined,
  now: Date,
  workDate: string,
  finalExitWindowBeforeMin: number,
  finalExitWindowStart: Date | undefined,
): ResolvedMark | RepeatedMark {
  const closed: RepeatedMark = { repeated: true, message: describeClosedShift(marks) };
  const checkOut = marks.checkOut;
  const logId = marks.checkOutLogId;
  if (!checkOut || !logId || now <= checkOut) return closed;
  const minutesSinceExit = (now.getTime() - checkOut.getTime()) / 60_000;

  if (marks.checkOutSource === TimeLogSource.AUTO_CLOSE) {
    return {
      nextLogType: TimeLogType.CHECK_OUT,
      workDate,
      reason: 'La salida de esta jornada la habia puesto el cierre automatico; la persona marco su salida real, que la reemplaza.',
      amend: { kind: 'REPLACE_EXIT', logId, wasAutoClose: true },
    };
  }

  if (minutesSinceExit < MIN_MINUTES_BETWEEN_MARKS) {
    return repeatedMark(TimeLogType.CHECK_OUT, checkOut, 'No hace falta marcar de nuevo.');
  }

  const wasEarlyExit = plannedShift !== undefined && finalExitWindowStart !== undefined && checkOut < finalExitWindowStart;
  if (!wasEarlyExit) return closed;

  if (!marks.lunchOut && !marks.lunchIn) {
    const amend: MarkAmendment = { kind: 'RETYPE_EXIT_AS_LUNCH_OUT', logId };
    const exitWindowStart = new Date(plannedShift.end.getTime() - finalExitWindowBeforeMin * 60_000);
    if (now >= exitWindowStart) {
      return {
        nextLogType: TimeLogType.CHECK_OUT,
        workDate,
        reason: `La salida anticipada de las ${hhmmOf(checkOut)} no fue la definitiva (la persona volvio a marcar a la hora de salida): se corrige a salida a descanso y esta marca es la salida del dia.`,
        amend,
      };
    }
    return {
      nextLogType: TimeLogType.LUNCH_IN,
      workDate,
      reason: `La salida anticipada de las ${hhmmOf(checkOut)} no fue la definitiva (la persona volvio): se corrige a salida a descanso y esta marca es el regreso.`,
      amend,
    };
  }

  if (minutesSinceExit < MIN_MINUTES_TO_REPLACE_EARLY_EXIT) {
    return repeatedMark(TimeLogType.CHECK_OUT, checkOut, 'No hace falta marcar de nuevo.');
  }
  return {
    nextLogType: TimeLogType.CHECK_OUT,
    workDate,
    reason: `La salida anticipada de las ${hhmmOf(checkOut)} no fue la definitiva (la persona siguio en el sitio): esta marca la reemplaza como salida del dia.`,
    amend: { kind: 'REPLACE_EXIT', logId, wasAutoClose: false },
  };
}

export async function resolveNextMark(
  prisma: PrismaService,
  userId: string,
  now: Date,
  context: MarkResolutionContext,
): Promise<ResolvedMark | RepeatedMark | null> {
  const result = (await resolveSplitDayMark(prisma, userId, now, context)) ?? (await resolveNextMarkByShift(prisma, userId, now, context));
  // En un dia de dos bloques la pausa no es un almuerzo: el mensaje habla de "descanso".
  if (result && context.breakIsRest && isRepeatedMark(result)) {
    return {
      ...result,
      message: result.message
        .replace(MARK_NAMES[TimeLogType.LUNCH_OUT], 'tu salida a descanso')
        .replace(MARK_NAMES[TimeLogType.LUNCH_IN], 'tu entrada de descanso'),
    };
  }
  return result;
}

/**
 * Reglas propias de un dia partido por la medianoche (turno de noche manejado
 * por dia calendario: bloque de la madrugada 00:00-06:00 y bloque de la noche
 * 22:00-24:00). Devuelve la decision si alguna regla aplica, o null para que
 * siga la logica general.
 *
 *  - La comida del turno ya no se marca: una marca en ese rango se rechaza
 *    con un mensaje claro (antes se guardaba como "salida" y danaba el dia).
 *  - Durante el descanso largo entre bloques, una marca de mas no es la
 *    "entrada de descanso": solo cuenta como tal cuando ya se acerca el
 *    segundo bloque.
 *  - Si falta la entrada (olvido marcar al llegar la noche anterior, asi que
 *    a medianoche el sistema no le puso la de hoy), la marca del final de la
 *    madrugada se guarda como su salida, no como una entrada; queda una
 *    jornada sin entrada, que completa el supervisor.
 */
async function resolveSplitDayMark(
  prisma: PrismaService,
  userId: string,
  now: Date,
  context: MarkResolutionContext,
): Promise<ResolvedMark | RepeatedMark | null> {
  const blocks = context.dayBlocks;
  if (!blocks || blocks.length === 0) return null;
  const today = startOfLocalDay(now);
  const workDate = dateKey(today);
  const first = blocks[0];
  const second = blocks[1];
  const exitWindowMs = (context.finalExitWindowBeforeMin ?? DEFAULT_FINAL_EXIT_WINDOW_BEFORE_MIN) * 60_000;
  const nearSecondBlock = Boolean(second) && now.getTime() >= second.start.getTime() - MIN_MINUTES_BEFORE_NEXT_SHIFT_START * 60_000;

  const logs = await prisma.timeLog.findMany({
    where: { userId, loggedAt: { gte: today, lte: now } },
    orderBy: { loggedAt: 'asc' },
    select: { logType: true, loggedAt: true },
  });
  const last = (type: TimeLogType) => [...logs].reverse().find((log) => log.logType === type);
  const checkIn = last(TimeLogType.CHECK_IN);
  const lunchOut = last(TimeLogType.LUNCH_OUT);
  const lunchIn = last(TimeLogType.LUNCH_IN);
  const checkOut = last(TimeLogType.CHECK_OUT);
  const lastLog = logs[logs.length - 1];
  const isInside = Boolean(lastLog && (lastLog.logType === TimeLogType.CHECK_IN || lastLog.logType === TimeLogType.LUNCH_IN));

  // La comida del turno de noche no se marca.
  if (isInside && context.mealWindows?.some((window) => now >= window.start && now <= window.end)) {
    return {
      repeated: true,
      message: 'La comida del turno de noche ya no se marca: el sistema la descuenta sola. No se guardo esta marca.',
    };
  }

  if (second && !nearSecondBlock) {
    const nextBlock = `Tu siguiente bloque empieza a las ${hhmmOf(second.start)}.`;
    // Ya salio a su descanso (o se fue antes): una marca mas, lejos del segundo bloque, es repetida.
    if (lunchOut && !lunchIn) return repeatedMark(TimeLogType.LUNCH_OUT, lunchOut.loggedAt, nextBlock);
    if (checkOut && !lunchOut) return repeatedMark(TimeLogType.CHECK_OUT, checkOut.loggedAt, nextBlock);
  }

  if (checkIn) return null; // con entrada: sigue la logica general

  // --- Sin entrada hoy ---
  const atEndOfFirstBlock = Boolean(context.continuesFromYesterday) && now.getTime() >= first.end.getTime() - exitWindowMs;
  if (second) {
    if (!nearSecondBlock && atEndOfFirstBlock) {
      return {
        nextLogType: TimeLogType.LUNCH_OUT,
        workDate,
        reason: 'Fin del primer bloque del dia sin entrada registrada: se guarda como salida a descanso (falta la entrada, que debe completar un supervisor).',
      };
    }
    if (nearSecondBlock && lunchOut && !lunchIn) {
      return { nextLogType: TimeLogType.LUNCH_IN, workDate, reason: 'Vuelve de su descanso para el segundo bloque del dia (jornada sin entrada registrada).' };
    }
    if (nearSecondBlock && lunchIn && !checkOut) {
      return repeatedMark(TimeLogType.LUNCH_IN, lunchIn.loggedAt, 'No hace falta marcar de nuevo.');
    }
    return null;
  }

  if (atEndOfFirstBlock) {
    if (checkOut) return repeatedMark(TimeLogType.CHECK_OUT, checkOut.loggedAt, 'No hace falta marcar de nuevo.');
    return {
      nextLogType: TimeLogType.CHECK_OUT,
      workDate,
      reason: 'Fin del turno sin entrada registrada: se guarda como salida (falta la entrada, que debe completar un supervisor).',
    };
  }
  return null;
}

async function resolveNextMarkByShift(
  prisma: PrismaService,
  userId: string,
  now: Date,
  context: MarkResolutionContext,
): Promise<ResolvedMark | RepeatedMark | null> {
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
    const nightShift = context.yesterdayPlannedShift;
    if (nightShift && crossesMidnight(nightShift)) {
      const graceEnd = new Date(nightShift.end.getTime() + nightShiftGraceMin * 60_000);
      // El turno de HOY todavia esta lejos: una marca ahora es de anoche, no la entrada de hoy.
      const todayShiftIsFar =
        !context.todayPlannedShift ||
        context.todayPlannedShift.start.getTime() - now.getTime() > MIN_MINUTES_BEFORE_NEXT_SHIFT_START * 60_000;

      const yesterday = addDays(today, -1);
      const yesterdayMarks = await findShiftMarks(prisma, userId, yesterday);

      if (now <= graceEnd) {
        if (yesterdayMarks.checkIn) {
          const decided = decideForOpenShift(
            yesterdayMarks,
            nightShift,
            context.allowsLunchSkip,
            context.defaultLunchMinutes,
            now,
            dateKey(yesterday),
            finalExitWindowBeforeMin,
            lunchWindow,
          );
          if (decided && !isRepeatedMark(decided)) {
            return {
              ...decided,
              reason: `Continua el turno nocturno de ayer (horario cruza medianoche, dentro del margen de ${nightShiftGraceMin} min tras su salida programada). ${decided.reason}`,
            };
          }
          // Marca repetida dentro del turno de anoche, o turno de anoche ya
          // cerrado: mientras al turno de hoy le falte, NO es una entrada.
          // (Antes, el que marcaba la salida a las 6:04 y otra vez a las 7:15
          // quedaba con una "entrada" a las 7:15, y esa noche no podia entrar.)
          if (decided && (todayShiftIsFar || !yesterdayMarks.checkOut)) return decided;
        } else if (todayShiftIsFar && now.getTime() >= nightShift.end.getTime() - finalExitWindowBeforeMin * 60_000) {
          // Es la hora de salida del turno de anoche y no hay entrada de ese
          // turno: la persona olvido marcar al entrar y esta es su SALIDA.
          // Guardarla como "entrada" (lo que pasaba antes) le invertia todas
          // las marcas de las noches siguientes. Queda una salida sin entrada,
          // que el supervisor completa.
          const alreadyOut = await prisma.timeLog.findFirst({
            where: { userId, logType: TimeLogType.CHECK_OUT, loggedAt: { gte: today, lte: now } },
            select: { loggedAt: true },
          });
          if (alreadyOut) return repeatedMark(TimeLogType.CHECK_OUT, alreadyOut.loggedAt, 'No hace falta marcar de nuevo.');
          return {
            nextLogType: TimeLogType.CHECK_OUT,
            workDate: dateKey(yesterday),
            reason: 'Hora de salida del turno nocturno de ayer, sin entrada registrada de ese turno: se registra como salida (falta la entrada, que debe completar un supervisor).',
          };
        }
      } else if (yesterdayMarks.checkOut && context.todayPlannedShift && todayShiftIsFar) {
        // Ya salio del turno de anoche y su turno de hoy empieza en varias
        // horas (ej. vigilante que salio a las 6am y marca a las 10am): no es
        // la entrada de esta noche. Guardarla como entrada le dejaba pagas las
        // horas del dia sin haberlas trabajado, y esa noche el kiosco le decia
        // que ya habia entrado.
        return repeatedMark(
          TimeLogType.CHECK_OUT,
          yesterdayMarks.checkOut,
          `Tu turno de hoy empieza a las ${hhmmOf(context.todayPlannedShift.start)}; si vas a trabajar antes, avisa a tu supervisor.`,
        );
      }
    }
    // Una "entrada" a los pocos minutos de haber marcado la salida es la
    // salida repetida, no el inicio de una jornada nueva.
    const lastLog = await prisma.timeLog.findFirst({
      where: { userId, loggedAt: { lte: now } },
      orderBy: { loggedAt: 'desc' },
      select: { logType: true, loggedAt: true },
    });
    if (
      lastLog?.logType === TimeLogType.CHECK_OUT &&
      (now.getTime() - lastLog.loggedAt.getTime()) / 60_000 < MIN_MINUTES_SINCE_CHECK_IN_FOR_EARLY_EXIT
    ) {
      return repeatedMark(TimeLogType.CHECK_OUT, lastLog.loggedAt, 'No hace falta marcar de nuevo.');
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

/** Datos de la marca nueva, tal como la envia el kiosco o la app. */
export interface NewMarkData {
  workSiteId?: string | null;
  loggedAt: Date;
  source: TimeLogSource;
  latitude?: number;
  longitude?: number;
  gpsValid?: boolean;
  photoUrl?: string;
  faceCheck?: string | null;
  faceDistance?: number | null;
}

/**
 * Guarda la marca ya decidida por `resolveNextMark`, aplicando antes la
 * correccion a la salida anterior si la decision la trae (`resolved.amend`).
 * Debe llamarse dentro de la transaccion con el lock del usuario. Unico punto
 * de escritura para el kiosco y la app, para que ambos corrijan igual.
 */
export async function persistResolvedMark(
  tx: Prisma.TransactionClient,
  user: { id: string; companyId: string },
  resolved: ResolvedMark,
  data: NewMarkData,
): Promise<void> {
  const amend = resolved.amend;
  const previous = amend ? await tx.timeLog.findUnique({ where: { id: amend.logId } }) : null;
  const audit = (action: string) =>
    tx.auditLog.create({
      data: {
        companyId: user.companyId,
        userId: user.id,
        entity: 'TimeLog',
        entityId: amend!.logId,
        action,
        diff: {
          workDate: resolved.workDate,
          previousLogType: previous!.logType,
          previousLoggedAt: previous!.loggedAt.toISOString(),
          previousSource: previous!.source,
          previousPhotoUrl: previous!.photoUrl,
          newLogType: resolved.nextLogType,
          newLoggedAt: data.loggedAt.toISOString(),
          rule: resolved.reason,
        },
      },
    });

  if (amend?.kind === 'REPLACE_EXIT' && previous) {
    await tx.timeLog.update({ where: { id: amend.logId }, data: { ...data, logType: resolved.nextLogType } });
    if (amend.wasAutoClose) {
      // La alerta "no marco salida" del cierre automatico ya no aplica: si la marco.
      await tx.novelty.deleteMany({
        where: { sourceTimeLogId: amend.logId, code: NoveltyCode.SALIDA_NO_REGISTRADA, status: NoveltyStatus.PENDIENTE },
      });
    }
    await audit(amend.wasAutoClose ? 'REPLACE_AUTO_CLOSE_EXIT' : 'REPLACE_EARLY_EXIT');
    return;
  }

  if (amend?.kind === 'RETYPE_EXIT_AS_LUNCH_OUT' && previous) {
    await tx.timeLog.update({ where: { id: amend.logId }, data: { logType: TimeLogType.LUNCH_OUT } });
    await audit('RETYPE_EARLY_EXIT_AS_LUNCH_OUT');
  }

  await tx.timeLog.create({ data: { userId: user.id, logType: resolved.nextLogType, ...data } });
}

/**
 * La base solo admite UNA marca de cada tipo por persona y dia de calendario
 * (indice unico uq_time_logs_user_day_type). En turnos nocturnos puede pasar
 * legitimamente dos veces el mismo dia (ej. sale a las 6am del turno de
 * anoche y esa misma noche se devuelve a las 11:30pm). No se puede guardar,
 * pero la persona debe recibir un mensaje claro y no un error interno.
 */
export function isDuplicateMarkError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

export function duplicateMarkMessage(type: TimeLogType): string {
  return `Hoy ya hay otra marca de ${MARK_NAMES[type].replace('tu ', '')} a tu nombre y el sistema solo admite una por dia. Esta no quedo guardada: avisa a tu supervisor para que la registre.`;
}
