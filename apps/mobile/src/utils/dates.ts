/** Fecha LOCAL del telefono como YYYY-MM-DD (toISOString daria la de UTC: despues de las 7 p. m. en Colombia ya seria "manana"). */
export function localDateISO(date: Date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function addDaysISO(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return localDateISO(new Date(y, m - 1, d + days));
}

const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** "martes 17 nov 2026" */
export function formatDateLong(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return `${WEEKDAYS[date.getDay()]} ${d} ${MONTHS[m - 1]} ${y}`;
}

/** "1 hora", "0.5 horas", "2 horas" */
export function hoursLabel(hours: number): string {
  return `${hours} ${hours === 1 ? 'hora' : 'horas'}`;
}
