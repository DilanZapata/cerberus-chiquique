import { WorkSegment } from './time-window';

/** Horas acumuladas por concepto legal (CST Colombia). */
export interface HourBuckets {
  /** Recargo Nocturno Ordinario: horas dentro de la jornada ordinaria trabajadas en franja nocturna. */
  RNO: number;
  /** Dominical / Festivo Ordinario (diurno): jornada ordinaria trabajada en domingo/festivo, en el dia. */
  DDCOF: number;
  /** Dominical / Festivo Nocturno: jornada ordinaria trabajada en domingo/festivo, en la noche. */
  DNCOF: number;
  /** Hora Extra Ordinaria Diurna. */
  HEOD: number;
  /** Hora Extra Ordinaria Nocturna. */
  HEON: number;
  /** Hora Extra Festiva/Dominical Diurna. */
  HEFD: number;
  /** Hora Extra Festiva/Dominical Nocturna. */
  HEFN: number;
  /** Horas ordinarias diurnas normales (sin recargo); informativas, no llevan recargo. */
  ordinaryDiurnoHours: number;
}

export function emptyBuckets(): HourBuckets {
  return { RNO: 0, DDCOF: 0, DNCOF: 0, HEOD: 0, HEON: 0, HEFD: 0, HEFN: 0, ordinaryDiurnoHours: 0 };
}

export function mergeBuckets(target: HourBuckets, source: HourBuckets): void {
  (Object.keys(target) as Array<keyof HourBuckets>).forEach((key) => {
    target[key] += source[key];
  });
}

/**
 * Clasifica una serie de segmentos homogeneos (diurno/nocturno x domingo-festivo)
 * en los 7 conceptos legales, consumiendo un cupo de "horas ordinarias" pasado
 * por el llamador (`remainingOrdinaryMinutes`). Las horas que exceden el cupo
 * ordinario se clasifican como hora extra (HEOD/HEON/HEFD/HEFN).
 *
 * El cupo ordinario ya refleja, aguas arriba, el tope legal diario (art. 161
 * CST) y el remanente semanal vigente (Ley 2101 de 2021), de modo que este
 * modulo no necesita conocer esas reglas: solo distribuye minutos.
 */
export function classifySegments(
  segments: WorkSegment[],
  remainingOrdinaryMinutes: number,
): { buckets: HourBuckets; ordinaryMinutesConsumed: number } {
  const buckets = emptyBuckets();
  let remaining = Math.max(0, remainingOrdinaryMinutes);
  let consumed = 0;

  for (const segment of segments) {
    const totalMinutes = (segment.end.getTime() - segment.start.getTime()) / 60000;
    if (totalMinutes <= 0) continue;

    const ordinaryMinutes = Math.min(totalMinutes, remaining);
    const overtimeMinutes = totalMinutes - ordinaryMinutes;
    remaining -= ordinaryMinutes;
    consumed += ordinaryMinutes;

    const ordinaryHours = ordinaryMinutes / 60;
    const overtimeHours = overtimeMinutes / 60;

    if (segment.isHolidaySunday) {
      if (segment.isNight) {
        buckets.DNCOF += ordinaryHours;
        buckets.HEFN += overtimeHours;
      } else {
        buckets.DDCOF += ordinaryHours;
        buckets.HEFD += overtimeHours;
      }
    } else if (segment.isNight) {
      buckets.RNO += ordinaryHours;
      buckets.HEON += overtimeHours;
    } else {
      buckets.ordinaryDiurnoHours += ordinaryHours;
      buckets.HEOD += overtimeHours;
    }
  }

  return { buckets, ordinaryMinutesConsumed: consumed };
}
