import { addDaysUTC, computeEasterSunday } from './easter';

export interface ColombianHoliday {
  date: Date; // UTC midnight
  name: string;
  movedByLey51?: boolean;
}

/** Mueve una fecha al lunes siguiente si no cae ya en lunes (Ley 51 de 1983 - "Ley Emiliani"). */
function moveToNextMonday(date: Date): Date {
  const dow = date.getUTCDay(); // 0 = domingo ... 6 = sabado
  if (dow === 1) return date;
  const daysToAdd = (1 - dow + 7) % 7;
  return addDaysUTC(date, daysToAdd);
}

function ymd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Calcula los festivos colombianos de un ano, aplicando la Ley 51 de 1983
 * (Ley Emiliani) a los festivos que corresponda trasladar al lunes siguiente.
 */
export function getColombianHolidays(year: number): ColombianHoliday[] {
  const easter = computeEasterSunday(year);

  const fixed: ColombianHoliday[] = [
    { date: new Date(Date.UTC(year, 0, 1)), name: 'Ano Nuevo' },
    { date: new Date(Date.UTC(year, 4, 1)), name: 'Dia del Trabajo' },
    { date: new Date(Date.UTC(year, 6, 20)), name: 'Independencia de Colombia' },
    { date: new Date(Date.UTC(year, 7, 7)), name: 'Batalla de Boyaca' },
    { date: new Date(Date.UTC(year, 11, 8)), name: 'Inmaculada Concepcion' },
    { date: new Date(Date.UTC(year, 11, 25)), name: 'Navidad' },
  ];

  // Ligados a Pascua pero de dia fijo de semana (jueves/viernes): no se trasladan.
  const easterFixedWeekday: ColombianHoliday[] = [
    { date: addDaysUTC(easter, -3), name: 'Jueves Santo' },
    { date: addDaysUTC(easter, -2), name: 'Viernes Santo' },
  ];

  // Sujetos a traslado al lunes siguiente (Ley Emiliani).
  const emilianiCandidates: ColombianHoliday[] = [
    { date: new Date(Date.UTC(year, 0, 6)), name: 'Reyes Magos' },
    { date: new Date(Date.UTC(year, 2, 19)), name: 'San Jose' },
    { date: addDaysUTC(easter, 39), name: 'Ascension del Senor' },
    { date: addDaysUTC(easter, 60), name: 'Corpus Christi' },
    { date: addDaysUTC(easter, 68), name: 'Sagrado Corazon de Jesus' },
    { date: new Date(Date.UTC(year, 5, 29)), name: 'San Pedro y San Pablo' },
    { date: new Date(Date.UTC(year, 7, 15)), name: 'Asuncion de la Virgen' },
    { date: new Date(Date.UTC(year, 9, 12)), name: 'Dia de la Raza' },
    { date: new Date(Date.UTC(year, 10, 1)), name: 'Todos los Santos' },
    { date: new Date(Date.UTC(year, 10, 11)), name: 'Independencia de Cartagena' },
  ].map((h) => {
    const moved = moveToNextMonday(h.date);
    return { date: moved, name: h.name, movedByLey51: ymd(moved) !== ymd(h.date) };
  });

  return [...fixed, ...easterFixedWeekday, ...emilianiCandidates].sort(
    (a, b) => a.date.getTime() - b.date.getTime(),
  );
}

/** Cache en memoria por ano para evitar recalcular Pascua en cada llamada. */
const holidayCache = new Map<number, Set<string>>();

function getHolidaySet(year: number): Set<string> {
  let set = holidayCache.get(year);
  if (!set) {
    set = new Set(getColombianHolidays(year).map((h) => ymd(h.date)));
    holidayCache.set(year, set);
  }
  return set;
}

/** Indica si una fecha (dia calendario) es domingo o festivo colombiano. */
export function isSundayOrHoliday(date: Date): boolean {
  if (date.getUTCDay() === 0) return true;
  return getHolidaySet(date.getUTCFullYear()).has(ymd(date));
}
