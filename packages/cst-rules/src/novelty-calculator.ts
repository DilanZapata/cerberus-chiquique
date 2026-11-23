import {
  CalculatedNovelty,
  DailyCalculationResult,
  LunchPolicy,
  NoveltyCode,
  NoveltyOrigin,
  NoveltyStatus,
  PayrollConfigParams,
  PAYROLL_REPORT_NOVELTY_CODES,
} from '@cerberus/shared-types';
import { DayMarks, resolveLunch, subtractAutomaticBreaks } from './lunch-engine';
import { splitIntoHomogeneousSegments } from './time-window';
import { classifySegments, emptyBuckets, HourBuckets, mergeBuckets } from './hours-classifier';
import { round, roundHoursToHalfHourBlocks, roundMinutesToHalfHourBlocks } from './math-utils';

const MINUTE_MS = 60_000;

const OVERTIME_CODES = new Set<NoveltyCode>([
  NoveltyCode.HEOD,
  NoveltyCode.HEON,
  NoveltyCode.HEFD,
  NoveltyCode.HEFN,
]);

const OVERTIME_BUCKET_KEYS: Array<keyof HourBuckets> = ['HEOD', 'HEON', 'HEFD', 'HEFN'];

export interface PlannedShiftWindow {
  start: Date;
  end: Date;
}

export interface CalculateDailyNoveltiesInput {
  userId: string;
  workDate: string; // YYYY-MM-DD
  marks: DayMarks;
  lunchPolicy: LunchPolicy;
  payrollConfig: PayrollConfigParams;
  /** Horario programado del dia, usado para detectar llegadas tarde / salidas anticipadas. */
  plannedShift?: PlannedShiftWindow;
  /** Pausas automaticas que no se marcan (ej. comida dentro de un turno nocturno partido): se descuentan de lo trabajado. */
  extraBreaks?: PlannedShiftWindow[];
  /**
   * Los dos bloques de trabajo de un dia partido por la medianoche (ej. 00:00
   * a 06:00 y 22:00 a 24:00), cuando el dia tiene dos. Con esto la llegada
   * tarde, la salida anticipada y la ausencia se miden contra CADA bloque, en
   * vez de tratar el descanso largo del medio como un "almuerzo".
   */
  plannedBlocks?: PlannedShiftWindow[];
  /**
   * true cuando el horario (cargo, individual o rutina) marca este dia como
   * NO laboral (dia de descanso) y aun asi el empleado trabajo. En ese caso
   * el dia no tiene cupo ordinario propio: todo lo trabajado es hora extra
   * (HEFD/HEFN si ademas es domingo/festivo, HEOD/HEON si no), a diferencia
   * de un dia sin horario asignado en absoluto, que si usa el tope legal de
   * 8h como respaldo (no hay como saber si "deberia" ser descanso o no).
   */
  isScheduledRestDay?: boolean;
  /** Minutos ordinarios ya consumidos esta semana ISO, ANTES de este dia (ver WeeklyOrdinaryHoursAccumulator). */
  weekOrdinaryMinutesAccumulated: number;
  /** Minutos de hora extra (HEOD+HEON+HEFD+HEFN) ya acumulados esta semana ISO, ANTES de este dia. */
  weekOvertimeMinutesAccumulated: number;
  /**
   * Minutos de tolerancia antes de que una llegada tarde/salida anticipada
   * empiece a contar horas (ver `roundMinutesToHalfHourBlocks`). Default: 15.
   */
  arrivalToleranceMinutes?: number;
}

/**
 * Punto de entrada principal del motor de calculo: dado el conjunto de marcas
 * de un empleado en un dia, produce la lista de novedades (CST Colombia) y
 * los totales de horas ordinarias/trabajadas.
 *
 * El calculo combina:
 *  1. Resolucion de almuerzo (lunch-engine): obtiene los intervalos
 *     realmente trabajados, excluyendo el bloque de almuerzo, y genera
 *     novedades de llegada tarde / abandono de almuerzo.
 *  2. Deteccion de llegada tarde / salida anticipada respecto al turno
 *     programado.
 *  3. Clasificacion de cada intervalo trabajado en los 7 conceptos legales
 *     (RNO, DDCOF, DNCOF, HEOD, HEON, HEFD, HEFN). Con horario programado,
 *     lo ordinario corre de la hora de entrada a la de salida programadas
 *     (sin importar si la entrada fue tarde) y lo trabajado antes o despues
 *     es hora extra; sin
 *     horario, se usa el tope legal diario de siempre. En ambos casos se
 *     respeta ademas el remanente semanal vigente.
 *  4. Si hay horas extra y la empresa exige autorizacion previa, quedan en
 *     estado PENDIENTE y se agrega la novedad agregada HORA_EXTRA_PENDIENTE
 *     para alimentar el panel de aprobacion.
 */
export function calculateDailyNovelties(input: CalculateDailyNoveltiesInput): DailyCalculationResult {
  const { marks, lunchPolicy, payrollConfig, workDate, userId } = input;
  const arrivalTolerance = input.arrivalToleranceMinutes ?? 15;

  // La regla es "se permite omitir el almuerzo para SALIR TEMPRANO", no
  // "trabajar el almuerzo de regalo": si el empleado puede omitirlo Y este
  // dia realmente paso derecho (no marco ni salida ni reingreso de
  // almuerzo), su salida programada se adelanta esos minutos. Si ese mismo
  // dia SI salio a almorzar (aunque tenga el permiso habilitado en su
  // perfil), su salida programada sigue siendo la normal — el permiso es
  // por dia, no un descuento fijo del horario.
  let plannedShift = input.plannedShift;
  if (plannedShift && lunchPolicy.allowsLunchSkip && !marks.lunchOut && !marks.lunchIn) {
    plannedShift = {
      start: plannedShift.start,
      end: new Date(plannedShift.end.getTime() - lunchPolicy.defaultLunchMinutes * MINUTE_MS),
    };
  }

  const novelties: CalculatedNovelty[] = [];

  const lunchResolution = resolveLunch(marks, lunchPolicy, undefined, input.plannedShift);

  // Dia de dos bloques (turno que cruza la medianoche, manejado por dia
  // calendario): la pausa que se marca es el descanso largo entre bloques,
  // no un almuerzo. Sus novedades se expresan contra cada bloque.
  const blocks = input.plannedBlocks && input.plannedBlocks.length === 2 ? input.plannedBlocks : undefined;
  const missedFirstBlock = Boolean(blocks && marks.checkIn && marks.checkIn >= blocks[0].end);
  const LUNCH_ONLY_CODES: NoveltyCode[] = [NoveltyCode.LLEGADA_TARDE_ALMUERZO, NoveltyCode.ABANDONO_ALMUERZO];
  novelties.push(...lunchResolution.novelties.filter((n) => !blocks || !LUNCH_ONLY_CODES.includes(n.code)));

  if (blocks) {
    const [first, second] = blocks;
    const clock = (date: Date) => {
      const text = date.toTimeString().slice(0, 5);
      return text === '00:00' && date > first.start ? '24:00' : text;
    };
    const hoursOf = (block: PlannedShiftWindow) => roundHoursToHalfHourBlocks((block.end.getTime() - block.start.getTime()) / (60 * MINUTE_MS));
    const absence = (block: PlannedShiftWindow, notes: string) =>
      novelties.push({
        code: NoveltyCode.AUSENCIA_INJUSTIFICADA,
        hours: hoursOf(block),
        status: NoveltyStatus.AUTO_CALCULADA,
        origin: NoveltyOrigin.SISTEMA,
        notes,
      });

    if (missedFirstBlock) {
      absence(first, `No trabajo su primer bloque del dia (${clock(first.start)} a ${clock(first.end)}), que es la continuacion del turno de la noche anterior.`);
    }
    if (marks.lunchOut && !missedFirstBlock) {
      const earlyMinutes = (first.end.getTime() - marks.lunchOut.getTime()) / MINUTE_MS;
      const earlyHours = roundMinutesToHalfHourBlocks(earlyMinutes, arrivalTolerance);
      if (earlyHours > 0) {
        novelties.push({
          code: NoveltyCode.SALIDA_ANTICIPADA,
          hours: earlyHours,
          status: NoveltyStatus.AUTO_CALCULADA,
          origin: NoveltyOrigin.SISTEMA,
          notes: `Salio a su descanso ${Math.round(earlyMinutes)} min antes del fin de su primer bloque (${clock(first.end)}).`,
        });
      }
    }
    if (marks.lunchIn) {
      const lateMinutes = (marks.lunchIn.getTime() - second.start.getTime()) / MINUTE_MS;
      const lateHours = roundMinutesToHalfHourBlocks(lateMinutes, arrivalTolerance);
      if (lateHours > 0) {
        novelties.push({
          code: NoveltyCode.LLEGADA_TARDE,
          hours: lateHours,
          status: NoveltyStatus.AUTO_CALCULADA,
          origin: NoveltyOrigin.SISTEMA,
          notes: `Volvio de su descanso ${Math.round(lateMinutes)} min despues del inicio de su segundo bloque (${clock(second.start)}).`,
        });
      }
    } else if (marks.lunchOut && lunchResolution.novelties.some((n) => n.code === NoveltyCode.ABANDONO_ALMUERZO)) {
      absence(second, `Salio a su descanso y no volvio para su segundo bloque del dia (${clock(second.start)} a ${clock(second.end)}).`);
    }
  }

  if (plannedShift && marks.checkIn) {
    // Quien no trabajo el primer bloque y llega para el segundo se mide contra el inicio del segundo.
    const expectedStart = blocks && missedFirstBlock ? blocks[1].start : plannedShift.start;
    const lateMinutes = (marks.checkIn.getTime() - expectedStart.getTime()) / MINUTE_MS;
    const lateHours = roundMinutesToHalfHourBlocks(lateMinutes, arrivalTolerance);
    if (lateHours > 0) {
      novelties.push({
        code: NoveltyCode.LLEGADA_TARDE,
        hours: lateHours,
        status: NoveltyStatus.AUTO_CALCULADA,
        origin: NoveltyOrigin.SISTEMA,
        notes: `Ingreso ${Math.round(lateMinutes)} min despues del horario programado.`,
      });
    }
  }

  if (plannedShift && marks.checkOut) {
    const earlyMinutes = (plannedShift.end.getTime() - marks.checkOut.getTime()) / MINUTE_MS;
    const earlyHours = roundMinutesToHalfHourBlocks(earlyMinutes, arrivalTolerance);
    if (earlyHours > 0) {
      novelties.push({
        code: NoveltyCode.SALIDA_ANTICIPADA,
        hours: earlyHours,
        status: NoveltyStatus.AUTO_CALCULADA,
        origin: NoveltyOrigin.SISTEMA,
        notes: `Salida ${Math.round(earlyMinutes)} min antes del horario programado.`,
      });
    }
  }

  const weeklyCapMinutes = Number(payrollConfig.maxWeeklyHours) * 60;
  const remainingWeeklyMinutes = Math.max(0, weeklyCapMinutes - input.weekOrdinaryMinutesAccumulated);

  // La jornada ordinaria de un dia nunca pasa del tope diario legal
  // (`maxDailyOrdinaryHours`, 8 h), TENGA O NO horario programado: si el turno
  // programado es mas largo (ej. ordeño de 3:00 a 9:00 y de 14:00 a 18:00 = 10
  // h, o un vigilante de 12 h), las primeras 8 h son ordinarias y el resto es
  // hora extra de ESE dia -- antes, con horario, las 10 h contaban como
  // ordinarias y la extra se amontonaba toda al final de la semana, cuando
  // se agotaba el tope semanal (y caia como extra dominical).
  // Ademas, si hay horario programado, la hora extra se cuenta contra la hora
  // de SALIDA programada (plannedShift.end, ver mas abajo), no contra una
  // bolsa de minutos que arranca desde la entrada real: llegar tarde no debe
  // retrasar (ni reducir) cuanta hora extra se detecta al final del turno.
  // Si el dia es de descanso segun el horario (isScheduledRestDay) y aun asi
  // se trabajo, el cupo ordinario de ese dia es 0: nada de lo trabajado cae
  // dentro de su jornada ordinaria, asi que todo es hora extra.
  const dailyCapMinutes = input.isScheduledRestDay ? 0 : Number(payrollConfig.maxDailyOrdinaryHours) * 60;
  let remainingCapForDay = Math.min(dailyCapMinutes, remainingWeeklyMinutes);

  const buckets = emptyBuckets();
  // Lo trabajado ANTES de la hora de entrada programada va aparte: es hora
  // extra (ver mas abajo) y se redondea por separado de la del final del turno.
  const bucketsBeforeShift = emptyBuckets();
  let ordinaryMinutesConsumedToday = 0;
  let totalWorkedMinutes = 0;
  const overtimeOrder: NoveltyCode[] = [];
  const noteOvertimeOrder = (keys: Array<keyof HourBuckets>) => {
    for (const key of keys) {
      const code = key as unknown as NoveltyCode;
      if (!overtimeOrder.includes(code)) overtimeOrder.push(code);
    }
  };

  for (const workedSegment of subtractAutomaticBreaks(lunchResolution.workedSegments, input.extraBreaks)) {
    let segment = workedSegment;

    // Con horario programado, la jornada ordinaria va de la hora de entrada a
    // la de salida del horario. Todo lo trabajado fuera de ella es hora
    // extra: tanto lo de despues de la salida como lo de ANTES de la entrada
    // (quien marca a las 6:40 con turno de 8:00 hizo 1h20 de extra, que queda
    // pendiente de autorizar como cualquier otra; antes se pagaba como tiempo
    // ordinario, sin que nadie lo aprobara).
    if (plannedShift && segment.start < plannedShift.start) {
      const beforeShiftEnd = new Date(Math.min(segment.end.getTime(), plannedShift.start.getTime()));
      const beforeShift = classifySegments(
        splitIntoHomogeneousSegments(segment.start, beforeShiftEnd, payrollConfig.dayStartTime, payrollConfig.nightStartTime),
        0, // sin cupo ordinario: todo es extra
      );
      noteOvertimeOrder(beforeShift.overtimeOrder);
      mergeBuckets(bucketsBeforeShift, beforeShift.buckets);
      totalWorkedMinutes += (beforeShiftEnd.getTime() - segment.start.getTime()) / MINUTE_MS;
      if (beforeShiftEnd >= segment.end) continue;
      segment = { start: beforeShiftEnd, end: segment.end };
    }

    let segmentOrdinaryCap = remainingCapForDay;
    if (plannedShift) {
      const minutesUntilScheduledEnd = Math.max(0, (plannedShift.end.getTime() - segment.start.getTime()) / MINUTE_MS);
      segmentOrdinaryCap = Math.min(segmentOrdinaryCap, minutesUntilScheduledEnd);
    }

    const homogeneousSegments = splitIntoHomogeneousSegments(
      segment.start,
      segment.end,
      payrollConfig.dayStartTime,
      payrollConfig.nightStartTime,
    );
    const { buckets: segmentBuckets, ordinaryMinutesConsumed, overtimeOrder: segmentOvertimeOrder } = classifySegments(
      homogeneousSegments,
      segmentOrdinaryCap,
    );
    noteOvertimeOrder(segmentOvertimeOrder);
    remainingCapForDay -= ordinaryMinutesConsumed;
    ordinaryMinutesConsumedToday += ordinaryMinutesConsumed;
    mergeBuckets(buckets, segmentBuckets);
    totalWorkedMinutes += (segment.end.getTime() - segment.start.getTime()) / MINUTE_MS;
  }

  // Las horas extra (no las ordinarias/recargos) se redondean en bloques de
  // media hora con tolerancia de 15 min: los primeros 15 min de mas no
  // cuentan, de ahi en adelante suben de a 0.5h (ver roundMinutesToHalfHourBlocks).
  // La extra de antes del turno y la de despues se redondean cada una por su
  // lado: llegar 10 min antes y salir 10 min despues no suma media hora extra.
  for (const key of OVERTIME_BUCKET_KEYS) {
    buckets[key] =
      roundMinutesToHalfHourBlocks(buckets[key] * 60, arrivalTolerance) +
      roundMinutesToHalfHourBlocks(bucketsBeforeShift[key] * 60, arrivalTolerance);
  }

  for (const code of PAYROLL_REPORT_NOVELTY_CODES) {
    const hours = buckets[code];
    if (hours <= 0) continue;

    // Las extras ya vienen redondeadas en bloques de media hora; los recargos
    // (nocturno, dominical) se redondean aqui con la misma regla de 15 min.
    const shownHours = OVERTIME_CODES.has(code) ? round(hours) : roundHoursToHalfHourBlocks(hours);
    if (shownHours <= 0) continue;

    novelties.push({
      code,
      hours: shownHours,
      status:
        OVERTIME_CODES.has(code) && payrollConfig.overtimeRequiresPreauthorization
          ? NoveltyStatus.PENDIENTE
          : NoveltyStatus.AUTO_CALCULADA,
      origin: NoveltyOrigin.SISTEMA,
    });
  }

  const pendingOvertimeHours = novelties
    .filter((n) => n.status === NoveltyStatus.PENDIENTE && OVERTIME_CODES.has(n.code))
    .reduce((sum, n) => sum + n.hours, 0);

  const hasPendingOvertime = pendingOvertimeHours > 0;

  if (hasPendingOvertime) {
    novelties.push({
      code: NoveltyCode.HORA_EXTRA_PENDIENTE,
      hours: round(pendingOvertimeHours),
      status: NoveltyStatus.PENDIENTE,
      origin: NoveltyOrigin.SISTEMA,
      notes: 'Horas extra detectadas sin autorizacion previa; requieren aprobacion de un supervisor.',
    });
  }

  const totalOvertimeHoursToday = round(
    buckets.HEOD + buckets.HEON + buckets.HEFD + buckets.HEFN,
  );

  // Alerta de cumplimiento (Art. 22 Ley 50/1990 mod. Art. 13 Ley 2466/2025): maximo
  // 2h extra/dia y 12h extra/semana, ambos topes deben respetarse simultaneamente.
  // Es informativa: no se puede impedir retroactivamente que ya se trabajaron esas horas.
  const weekOvertimeHoursAccumulated = input.weekOvertimeMinutesAccumulated / 60;
  const exceedsDailyOvertimeCap = totalOvertimeHoursToday > Number(payrollConfig.maxDailyOvertimeHours);
  const exceedsWeeklyOvertimeCap =
    weekOvertimeHoursAccumulated + totalOvertimeHoursToday > Number(payrollConfig.maxWeeklyOvertimeHours);

  if (totalOvertimeHoursToday > 0 && (exceedsDailyOvertimeCap || exceedsWeeklyOvertimeCap)) {
    const reasons: string[] = [];
    if (exceedsDailyOvertimeCap) {
      reasons.push(`tope diario de ${payrollConfig.maxDailyOvertimeHours}h`);
    }
    if (exceedsWeeklyOvertimeCap) {
      reasons.push(`tope semanal de ${payrollConfig.maxWeeklyOvertimeHours}h`);
    }
    novelties.push({
      code: NoveltyCode.LIMITE_HORAS_EXTRA_EXCEDIDO,
      hours: round(totalOvertimeHoursToday),
      status: NoveltyStatus.AUTO_CALCULADA,
      origin: NoveltyOrigin.SISTEMA,
      notes: `Se supero el ${reasons.join(' y el ')} de horas extra (Ley 2466 de 2025). Alerta de cumplimiento, no bloquea el pago.`,
    });
  }

  return {
    userId,
    workDate,
    novelties,
    totalOrdinaryHours: roundMinutesToHalfHourBlocks(ordinaryMinutesConsumedToday, arrivalTolerance),
    totalOvertimeHours: totalOvertimeHoursToday,
    totalWorkedHours: roundMinutesToHalfHourBlocks(totalWorkedMinutes, arrivalTolerance),
    hasPendingOvertime,
    overtimeOrder,
  };
}
