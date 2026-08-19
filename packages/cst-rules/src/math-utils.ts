/** Redondea a N decimales evitando errores de coma flotante (ej. 1.0049999...). */
export function round(value: number, decimals = 3): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

/**
 * Redondeo de nomina en bloques de media hora con tolerancia inicial: los
 * primeros `toleranceMinutes` (15 por defecto) no cuentan nada, y a partir
 * de ahi se sube en bloques de 30 minutos. Ej. con tolerancia de 15:
 * 0-15 min -> 0h, 16-45 min -> 0.5h, 46-75 min -> 1h, 76-105 min -> 1.5h...
 * Se usa tanto para horas extra (minutos trabajados de mas) como para
 * llegada tarde / salida anticipada (minutos de diferencia con el horario).
 */
export function roundMinutesToHalfHourBlocks(minutes: number, toleranceMinutes = 15): number {
  if (minutes <= toleranceMinutes) return 0;
  return Math.ceil((minutes - toleranceMinutes) / 30) * 0.5;
}
