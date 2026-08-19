/** Convierte un campo @db.Time de Prisma (Date en epoch UTC) a "HH:mm". */
export function timeToHHmm(time: Date): string {
  return `${String(time.getUTCHours()).padStart(2, '0')}:${String(time.getUTCMinutes()).padStart(2, '0')}`;
}

/** Convierte "HH:mm" a un Date en epoch UTC, listo para escribir en un campo @db.Time de Prisma. */
export function hhmmToTime(hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(Date.UTC(1970, 0, 1, h, m));
}

/** Combina una fecha calendario con un campo @db.Time de Prisma (Date en epoch UTC), en hora local. */
export function combineDateAndTime(date: Date, time: Date): Date {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    time.getUTCHours(),
    time.getUTCMinutes(),
    0,
    0,
  );
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * Numero entero de dias calendario entre dos fechas (b - a), ignorando la hora.
 * Usa getters UTC porque los campos @db.Date de Prisma (ej. anchor_date) se
 * devuelven como medianoche UTC; leerlos con getters locales en un servidor
 * con offset horario (ej. America/Bogota, UTC-5) desfasaria el dia calendario
 * en uno. Como este proyecto siempre construye fechas "de medianoche local"
 * en un huso horario detras de UTC (Colombia, UTC-5, sin horario de verano),
 * la medianoche local cae en la misma fecha UTC, asi que usar getters UTC en
 * ambos lados da el resultado correcto de forma consistente.
 */
export function daysBetween(a: Date, b: Date): number {
  const start = Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate());
  const end = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate());
  return Math.round((end - start) / 86_400_000);
}
