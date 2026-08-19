/**
 * Agrupa minutos ordinarios consumidos por semana ISO 8601 (lunes-domingo),
 * necesario para aplicar el limite de horas semanales vigente en Colombia
 * (Ley 2101 de 2021: 47h -> 46h -> 44h -> 42h segun la fecha de corte legal).
 *
 * Uso esperado: procesar los dias de un empleado en orden cronologico,
 * consultando `get(weekKey)` ANTES de calcular el dia (para saber cuanto cupo
 * ordinario queda esa semana) y llamando `add(weekKey, minutos)` DESPUES con
 * los minutos ordinarios que realmente consumio ese dia.
 */
export class WeeklyOrdinaryHoursAccumulator {
  private readonly minutesByWeekKey = new Map<string, number>();

  add(weekKey: string, minutes: number): void {
    this.minutesByWeekKey.set(weekKey, (this.minutesByWeekKey.get(weekKey) ?? 0) + minutes);
  }

  get(weekKey: string): number {
    return this.minutesByWeekKey.get(weekKey) ?? 0;
  }
}

/** Retorna la llave de semana ISO ("2026-W03") para un dia dado. */
export function getIsoWeekKey(date: Date): string {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayNum = d.getDay() || 7; // lunes=1 ... domingo=7
  d.setDate(d.getDate() + 4 - dayNum);
  const yearStart = new Date(d.getFullYear(), 0, 1);
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${d.getFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}
