import { CycleWeek } from '@prisma/client';
import { daysBetween } from './time.util';

/**
 * Determina, para un ciclo rotativo de dos semanas, cual semana (A o B) le
 * corresponde a `date` dado el ancla (`anchorDate`) y la semana en la que
 * arranco el ciclo (`startWeek`) de una asignacion individual (UserSchedule).
 *
 * Es una funcion pura (sin Prisma/NestJS) para poder probarla de forma
 * aislada: el numero de semanas transcurridas desde el ancla determina la
 * paridad (par = misma semana que el inicio, impar = la otra), reutilizando
 * `daysBetween` -- el mismo idioma ya usado en shift-patterns.service.ts para
 * ciclos de N dias, valido para fechas anteriores O posteriores al ancla.
 */
export function resolveActiveCycleWeek(anchorDate: Date, startWeek: CycleWeek, date: Date): CycleWeek {
  const weeksElapsed = Math.floor(daysBetween(anchorDate, date) / 7);
  const isSameParityAsStart = ((weeksElapsed % 2) + 2) % 2 === 0;
  if (isSameParityAsStart) return startWeek;
  return startWeek === CycleWeek.A ? CycleWeek.B : CycleWeek.A;
}
