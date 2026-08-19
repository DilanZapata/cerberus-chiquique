import { CalculatedNovelty, LunchPolicy } from '@cerberus/shared-types';
import { NoveltyCode, NoveltyOrigin, NoveltyStatus } from '@cerberus/shared-types';
import { round, roundMinutesToHalfHourBlocks } from './math-utils';

const MINUTE_MS = 60_000;

/** Marcas del dia (hasta 4 registros). */
export interface DayMarks {
  checkIn?: Date; // Marca 1
  lunchOut?: Date; // Marca 2
  lunchIn?: Date; // Marca 3
  checkOut?: Date; // Marca 4
}

export interface LunchResolution {
  /** Intervalos efectivamente trabajados, con el bloque de almuerzo ya excluido. */
  workedSegments: Array<{ start: Date; end: Date }>;
  novelties: CalculatedNovelty[];
  lunchMinutesDeducted: number;
}

/**
 * Resuelve la logica dinamica de almuerzo a partir de las 4 marcas posibles:
 *  - Si hay Marca 2 y Marca 3: se valida contra el tiempo predeterminado +
 *    tolerancia. Un reingreso tardio genera LLEGADA_TARDE_ALMUERZO. La ventana
 *    es dinamica: el tiempo se mide siempre relativo a la Marca 2, sin
 *    importar si el almuerzo se tomo a las 12, 13 o 14 horas.
 *  - Si hay Marca 2 pero no Marca 3 dentro del limite razonable, se genera
 *    ABANDONO_ALMUERZO ("Inasistencia/Abandono tras Almuerzo").
 *  - Si no hay Marca 2 (trabajo corrido): si el empleado tiene habilitada la
 *    omision de almuerzo, no se descuenta tiempo (el efecto de "adelantar" la
 *    salida ocurre naturalmente porque no hay hueco de almuerzo que restar).
 *    Si no la tiene habilitada, se descuenta automaticamente el tiempo
 *    predeterminado de almuerzo del final de la jornada.
 */
export function resolveLunch(marks: DayMarks, policy: LunchPolicy, now: Date = new Date()): LunchResolution {
  const novelties: CalculatedNovelty[] = [];

  if (!marks.checkIn) {
    return { workedSegments: [], novelties, lunchMinutesDeducted: 0 };
  }

  // Caso 1: ambas marcas de almuerzo presentes.
  if (marks.lunchOut && marks.lunchIn) {
    const actualMinutes = (marks.lunchIn.getTime() - marks.lunchOut.getTime()) / MINUTE_MS;
    // Mismo redondeo en bloques de 30 min con tolerancia (aqui la tolerancia
    // propia del horario, `lunchToleranceMinutes`) que llegada tarde/salida
    // anticipada/hora extra: los minutos de mas sobre el almuerzo estandar
    // no cuentan nada hasta pasar la tolerancia, luego suben de a 0.5h.
    const excessMinutes = Math.max(0, actualMinutes - policy.defaultLunchMinutes);
    const lateHours = roundMinutesToHalfHourBlocks(excessMinutes, policy.toleranceMinutes);

    if (lateHours > 0) {
      novelties.push({
        code: NoveltyCode.LLEGADA_TARDE_ALMUERZO,
        hours: lateHours,
        status: NoveltyStatus.AUTO_CALCULADA,
        origin: NoveltyOrigin.SISTEMA,
        notes: `Reingreso ${Math.round(excessMinutes)} min despues del tiempo de almuerzo estandar (tolerancia: ${policy.toleranceMinutes} min).`,
      });
    }

    const segments = [{ start: marks.checkIn, end: marks.lunchOut }];
    if (marks.checkOut) segments.push({ start: marks.lunchIn, end: marks.checkOut });
    return { workedSegments: segments, novelties, lunchMinutesDeducted: actualMinutes };
  }

  // Caso 2: salio a almuerzo pero nunca marco reingreso (Marca 3 ausente).
  if (marks.lunchOut && !marks.lunchIn) {
    const referenceEnd = marks.checkOut ?? now;
    const elapsedSinceLunchOut = (referenceEnd.getTime() - marks.lunchOut.getTime()) / MINUTE_MS;
    const allowedMinutes = policy.defaultLunchMinutes + policy.toleranceMinutes;

    if (elapsedSinceLunchOut > allowedMinutes) {
      novelties.push({
        code: NoveltyCode.ABANDONO_ALMUERZO,
        hours: round(elapsedSinceLunchOut / 60),
        status: NoveltyStatus.PENDIENTE,
        origin: NoveltyOrigin.SISTEMA,
        notes: 'No se registro el reingreso de almuerzo (Marca 3) dentro del limite permitido.',
      });
    }

    return {
      workedSegments: [{ start: marks.checkIn, end: marks.lunchOut }],
      novelties,
      lunchMinutesDeducted: policy.defaultLunchMinutes,
    };
  }

  // Caso 3: no se registro salida a almuerzo (jornada corrida).
  if (policy.allowsLunchSkip) {
    const segments = marks.checkOut ? [{ start: marks.checkIn, end: marks.checkOut }] : [];
    return { workedSegments: segments, novelties, lunchMinutesDeducted: 0 };
  }

  // Omision no habilitada para este empleado: se descuenta el almuerzo
  // predeterminado dentro de la ventana de almuerzo configurada (ej. 12:00-14:00),
  // no del final de la jornada. Restarlo al final distorsionaria la clasificacion
  // diurna/nocturna en turnos que cruzan el inicio de la jornada nocturna.
  if (marks.checkOut) {
    const checkIn = marks.checkIn;
    const checkOut = marks.checkOut;
    const totalMinutes = (checkOut.getTime() - checkIn.getTime()) / MINUTE_MS;
    const lunchMinutes = Math.min(policy.defaultLunchMinutes, Math.max(0, totalMinutes));

    const [windowStartHour, windowStartMinute] = policy.windowStart.split(':').map(Number);
    const windowInstanceOn = (referenceDate: Date) => {
      const instance = new Date(referenceDate);
      instance.setHours(windowStartHour, windowStartMinute, 0, 0);
      return instance;
    };
    const fitsInShift = (candidate: Date) =>
      candidate >= checkIn && candidate.getTime() + lunchMinutes * MINUTE_MS <= checkOut.getTime();

    // La ventana puede caer el mismo dia de la entrada (turno diurno normal)
    // o al dia siguiente (turno nocturno cuya salida cruza la ventana del
    // dia calendario posterior, ej. entra a las 6pm y sale a las 8am).
    const candidateSameDay = windowInstanceOn(checkIn);
    const candidateNextDay = new Date(candidateSameDay.getTime() + 24 * 60 * MINUTE_MS);

    let lunchStart: Date;
    if (fitsInShift(candidateSameDay)) {
      lunchStart = candidateSameDay;
    } else if (fitsInShift(candidateNextDay)) {
      lunchStart = candidateNextDay;
    } else {
      // La ventana configurada no cae dentro de este turno (ej. turno
      // nocturno sin ventana de almuerzo propia definida): se descuenta
      // cerca del final de la jornada como respaldo razonable.
      lunchStart = new Date(checkOut.getTime() - lunchMinutes * MINUTE_MS);
    }
    const lunchEnd = new Date(lunchStart.getTime() + lunchMinutes * MINUTE_MS);

    const segments =
      lunchStart <= checkIn
        ? [{ start: lunchEnd, end: checkOut }]
        : [
            { start: checkIn, end: lunchStart },
            { start: lunchEnd, end: checkOut },
          ];

    return {
      workedSegments: segments,
      novelties,
      lunchMinutesDeducted: lunchMinutes,
    };
  }

  return { workedSegments: [], novelties, lunchMinutesDeducted: 0 };
}
