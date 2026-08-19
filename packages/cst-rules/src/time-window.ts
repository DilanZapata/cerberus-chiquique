import { isSundayOrHoliday } from './colombian-holidays';

export interface WorkSegment {
  start: Date;
  end: Date;
  /** true si el segmento cae en horario nocturno (ver dayStartTime/nightStartTime). */
  isNight: boolean;
  /** true si el dia calendario del segmento es domingo o festivo colombiano. */
  isHolidaySunday: boolean;
}

/**
 * NOTA: este modulo asume que los objetos Date recibidos ya representan la
 * hora local de Colombia (America/Bogota) resuelta por la capa que llama
 * (API/base de datos manejan TIMESTAMPTZ). Aqui solo se usan los getters
 * locales (getHours, getDate, etc.) para no depender de una libreria de
 * zonas horarias dentro del motor de calculo puro.
 */

function parseHHmm(hhmm: string): { h: number; m: number } {
  const [h, m] = hhmm.split(':').map(Number);
  return { h, m };
}

function atLocalTime(reference: Date, hhmm: string): Date {
  const { h, m } = parseHHmm(hhmm);
  return new Date(reference.getFullYear(), reference.getMonth(), reference.getDate(), h, m, 0, 0);
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function isNightMoment(moment: Date, dayStartTime: string, nightStartTime: string): boolean {
  const dayStart = atLocalTime(moment, dayStartTime);
  const nightStart = atLocalTime(moment, nightStartTime);
  // Noche = [nightStart, 24:00) U [00:00, dayStart)
  if (moment >= nightStart) return true;
  if (moment < dayStart) return true;
  return false;
}

/**
 * Divide un intervalo de trabajo continuo [start, end) en segmentos homogeneos
 * respecto a: (a) franja diurna/nocturna y (b) dia calendario (para poder
 * determinar domingo/festivo por segmento). Es la base para clasificar las
 * horas trabajadas en los 7 conceptos legales (RNO, DDCOF, DNCOF, HEOD, HEON,
 * HEFD, HEFN).
 */
export function splitIntoHomogeneousSegments(
  start: Date,
  end: Date,
  dayStartTime: string,
  nightStartTime: string,
): WorkSegment[] {
  if (end <= start) return [];

  const boundaries = new Set<number>([start.getTime(), end.getTime()]);
  let cursor = startOfDay(start);
  while (cursor <= end) {
    const midnight = cursor.getTime();
    const dayBoundary = atLocalTime(cursor, dayStartTime).getTime();
    const nightBoundary = atLocalTime(cursor, nightStartTime).getTime();
    for (const point of [midnight, dayBoundary, nightBoundary]) {
      if (point > start.getTime() && point < end.getTime()) {
        boundaries.add(point);
      }
    }
    cursor = addDays(cursor, 1);
  }

  const sorted = Array.from(boundaries).sort((a, b) => a - b);
  const segments: WorkSegment[] = [];

  for (let i = 0; i < sorted.length - 1; i++) {
    const segStart = new Date(sorted[i]);
    const segEnd = new Date(sorted[i + 1]);
    if (segEnd <= segStart) continue;

    const midpoint = new Date((segStart.getTime() + segEnd.getTime()) / 2);
    segments.push({
      start: segStart,
      end: segEnd,
      isNight: isNightMoment(midpoint, dayStartTime, nightStartTime),
      isHolidaySunday: isSundayOrHoliday(startOfDay(segStart)),
    });
  }

  return segments;
}
