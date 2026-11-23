/** Redondea a N decimales evitando errores de coma flotante (ej. 1.0049999...). */
export function round(value: number, decimals = 3): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

/**
 * Redondeo de nomina en bloques de media hora con tolerancia inicial
 * (`toleranceMinutes`, 15 por defecto). Con tolerancia de 15:
 *   menos de 15 min      -> 0 h   (no cuenta nada)
 *   de 15 a menos de 45  -> 0.5 h
 *   de 45 a menos de 75  -> 1 h
 *   de 75 a menos de 105 -> 1.5 h ...
 * Ej.: salida programada a las 18:00; sale 18:16 -> 0.5 h; sale 18:46 -> 1 h.
 * Se usa para TODAS las horas que se muestran y se pagan: hora extra,
 * llegada tarde, salida anticipada, recargos (nocturno, dominical) y totales
 * del dia. Asi ninguna hora sale con decimales raros (4.871): siempre es un
 * numero entero o termina en ,5.
 */
export function roundMinutesToHalfHourBlocks(minutes: number, toleranceMinutes = 15): number {
  // Margen minimo contra errores de coma flotante (ej. 44.99999999 min).
  const exact = minutes + 1e-6;
  if (exact < toleranceMinutes) return 0;
  return (Math.floor((exact - toleranceMinutes) / 30) + 1) * 0.5;
}

/** La misma regla, para una cantidad que ya viene en horas (ej. 4.871 h -> 5 h; 3.129 h -> 3 h). */
export function roundHoursToHalfHourBlocks(hours: number): number {
  return roundMinutesToHalfHourBlocks(hours * 60, 15);
}
