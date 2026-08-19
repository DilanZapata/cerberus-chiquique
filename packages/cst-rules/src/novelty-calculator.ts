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
import { DayMarks, resolveLunch } from './lunch-engine';
import { splitIntoHomogeneousSegments } from './time-window';
import { classifySegments, emptyBuckets, HourBuckets, mergeBuckets } from './hours-classifier';
import { round, roundMinutesToHalfHourBlocks } from './math-utils';

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
 *     lo ordinario corre hasta la hora de salida programada (sin importar
 *     si la entrada fue tarde) y lo que sigue despues es hora extra; sin
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

  const lunchResolution = resolveLunch(marks, lunchPolicy);
  novelties.push(...lunchResolution.novelties);

  if (plannedShift && marks.checkIn) {
    const lateMinutes = (marks.checkIn.getTime() - plannedShift.start.getTime()) / MINUTE_MS;
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

  // Si hay horario programado, la hora extra se cuenta contra la hora de
  // SALIDA programada (plannedShift.end), no contra una bolsa de minutos que
  // arranca a contar desde la entrada real: llegar tarde no debe retrasar
  // (ni reducir) cuanta hora extra se detecta al final del turno. Sin
  // horario (ej. sin cargo/rutina asignada) no hay una hora de salida contra
  // que comparar, asi que se usa el tope legal diario de siempre como respaldo.
  // Si el dia es de descanso segun el horario (isScheduledRestDay) y aun asi
  // se trabajo, el cupo ordinario de ese dia es 0: nada de lo trabajado cae
  // dentro de su jornada ordinaria, asi que todo es hora extra.
  const dailyCapMinutes = input.isScheduledRestDay ? 0 : Number(payrollConfig.maxDailyOrdinaryHours) * 60;
  let remainingCapForDay = plannedShift ? remainingWeeklyMinutes : Math.min(dailyCapMinutes, remainingWeeklyMinutes);

  const buckets = emptyBuckets();
  let ordinaryMinutesConsumedToday = 0;
  let totalWorkedMinutes = 0;

  for (const segment of lunchResolution.workedSegments) {
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
    const { buckets: segmentBuckets, ordinaryMinutesConsumed } = classifySegments(
      homogeneousSegments,
      segmentOrdinaryCap,
    );
    remainingCapForDay -= ordinaryMinutesConsumed;
    ordinaryMinutesConsumedToday += ordinaryMinutesConsumed;
    mergeBuckets(buckets, segmentBuckets);
    totalWorkedMinutes += (segment.end.getTime() - segment.start.getTime()) / MINUTE_MS;
  }

  // Las horas extra (no las ordinarias/recargos) se redondean en bloques de
  // media hora con tolerancia de 15 min: los primeros 15 min de mas no
  // cuentan, de ahi en adelante suben de a 0.5h (ver roundMinutesToHalfHourBlocks).
  for (const key of OVERTIME_BUCKET_KEYS) {
    buckets[key] = roundMinutesToHalfHourBlocks(buckets[key] * 60, arrivalTolerance);
  }

  for (const code of PAYROLL_REPORT_NOVELTY_CODES) {
    const hours = buckets[code];
    if (hours <= 0) continue;

    novelties.push({
      code,
      hours: round(hours),
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
    totalOrdinaryHours: round(ordinaryMinutesConsumedToday / 60),
    totalOvertimeHours: totalOvertimeHoursToday,
    totalWorkedHours: round(totalWorkedMinutes / 60),
    hasPendingOvertime,
  };
}
