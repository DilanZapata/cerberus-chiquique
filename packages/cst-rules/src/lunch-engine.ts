import { CalculatedNovelty, LunchPolicy } from '@cerberus/shared-types';
import { NoveltyCode, NoveltyOrigin, NoveltyStatus } from '@cerberus/shared-types';
import { roundHoursToHalfHourBlocks, roundMinutesToHalfHourBlocks } from './math-utils';

const MINUTE_MS = 60_000;

/** Marcas del dia (hasta 4 registros). */
export interface DayMarks {
  checkIn?: Date; // Marca 1
  lunchOut?: Date; // Marca 2
  lunchIn?: Date; // Marca 3
  checkOut?: Date; // Marca 4
  /** true si la salida la puso el cierre automatico (la persona no la marco). */
  checkOutIsAutomatic?: boolean;
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
 *    ABANDONO_ALMUERZO ("Inasistencia/Abandono tras Almuerzo"). Excepcion: si
 *    la persona SI marco su salida del dia (Marca 4 real, no la del cierre
 *    automatico), es que volvio y solo olvido marcar el regreso: se asume el
 *    almuerzo estandar y la jornada queda senalada para revision.
 *  - Si no hay Marca 2 (trabajo corrido): si el empleado tiene habilitada la
 *    omision de almuerzo, no se descuenta tiempo (el efecto de "adelantar" la
 *    salida ocurre naturalmente porque no hay hueco de almuerzo que restar).
 *    Si no la tiene habilitada, se descuenta automaticamente el tiempo
 *    predeterminado de almuerzo, pero solo si la persona estaba trabajando a
 *    su hora de almuerzo (entro antes y salio despues). Quien llego despues
 *    del almuerzo o se fue antes no pierde esa hora.
 */
export function resolveLunch(
  marks: DayMarks,
  policy: LunchPolicy,
  now: Date = new Date(),
  /** Turno programado del dia, si lo hay: define cual es "su hora de almuerzo". */
  plannedShift?: { start: Date; end: Date },
): LunchResolution {
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
    // Olvido marcar el regreso, pero marco la salida del dia ella misma (en el
    // sitio, horas despues): la persona volvio a trabajar. Se asume que tomo
    // el almuerzo estandar, en vez de dejarle sin pagar toda la tarde como si
    // no hubiera vuelto. La salida del cierre automatico NO cuenta como
    // evidencia de regreso (nadie la marco).
    const assumedReturn = new Date(marks.lunchOut.getTime() + policy.defaultLunchMinutes * MINUTE_MS);
    if (marks.checkOut && !marks.checkOutIsAutomatic && marks.checkOut > assumedReturn) {
      novelties.push({
        code: NoveltyCode.JORNADA_REQUIERE_REVISION,
        hours: 0,
        status: NoveltyStatus.AUTO_CALCULADA,
        origin: NoveltyOrigin.SISTEMA,
        notes: `No marco el regreso de almuerzo, pero si marco su salida a las ${marks.checkOut.toTimeString().slice(0, 5)}: se asumio el almuerzo estandar de ${policy.defaultLunchMinutes} min. Verificar.`,
      });
      return {
        workedSegments: [
          { start: marks.checkIn, end: marks.lunchOut },
          { start: assumedReturn, end: marks.checkOut },
        ],
        novelties,
        lunchMinutesDeducted: policy.defaultLunchMinutes,
      };
    }

    const referenceEnd = marks.checkOut ?? now;
    const elapsedSinceLunchOut = (referenceEnd.getTime() - marks.lunchOut.getTime()) / MINUTE_MS;
    const allowedMinutes = policy.defaultLunchMinutes + policy.toleranceMinutes;

    if (elapsedSinceLunchOut > allowedMinutes) {
      novelties.push({
        code: NoveltyCode.ABANDONO_ALMUERZO,
        hours: roundHoursToHalfHourBlocks(elapsedSinceLunchOut / 60),
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
  //
  // El descuento SOLO aplica si la persona estaba trabajando a su hora de
  // almuerzo: entro antes de que empezara y seguia ahi cuando termino. A quien
  // llego despues del almuerzo (o en plena hora de almuerzo) o se fue antes,
  // no se le resta nada: no pudo haber almorzado en tiempo de trabajo.
  if (marks.checkOut) {
    const checkIn = marks.checkIn;
    const checkOut = marks.checkOut;
    const totalMinutes = (checkOut.getTime() - checkIn.getTime()) / MINUTE_MS;
    const lunchMinutes = Math.min(policy.defaultLunchMinutes, Math.max(0, totalMinutes));
    const fullDay = { workedSegments: [{ start: checkIn, end: checkOut }], novelties, lunchMinutesDeducted: 0 };
    if (lunchMinutes <= 0) return fullDay;

    const DAY_MS = 24 * 60 * MINUTE_MS;
    const [windowStartHour, windowStartMinute] = policy.windowStart.split(':').map(Number);
    const [windowEndHour, windowEndMinute] = policy.windowEnd.split(':').map(Number);
    const windowInstance = (referenceDate: Date, dayOffset: number) => {
      const start = new Date(referenceDate);
      start.setHours(windowStartHour, windowStartMinute, 0, 0);
      start.setTime(start.getTime() + dayOffset * DAY_MS);
      const end = new Date(start);
      end.setHours(windowEndHour, windowEndMinute, 0, 0);
      if (end <= start) end.setTime(end.getTime() + DAY_MS); // ventana que cruza medianoche
      return { start, end };
    };

    // La hora de almuerzo que le corresponde a esta jornada: la ventana que
    // cae sobre el turno programado (o, sin turno programado, sobre lo que
    // trabajo). Puede ser la del dia siguiente en un turno nocturno. Una
    // ventana que apenas TOCA el turno (empieza justo cuando el turno termina,
    // ej. media jornada de ordeño 4:00-8:00 con descanso de 8:00 a 16:00)
    // tambien cuenta como "la de este turno": asi cae en "el almuerzo no cabe
    // en el turno" (no se resta nada) en vez de en el respaldo de mas abajo.
    const reference = plannedShift ?? { start: checkIn, end: checkOut };
    const lunchWindow = [-1, 0, 1]
      .map((dayOffset) => windowInstance(reference.start, dayOffset))
      .find((window) => window.start <= reference.end && window.end >= reference.start);

    let lunchStart: Date;
    if (lunchWindow) {
      // Turno demasiado corto para que el almuerzo quepa antes de la salida
      // programada (ej. sabado medio dia 6:00-12:00 con almuerzo a las 11:30):
      // ese dia no hay almuerzo que descontar.
      const lunchFitsInShift =
        !plannedShift || plannedShift.end.getTime() > lunchWindow.start.getTime() + policy.defaultLunchMinutes * MINUTE_MS;
      // "Seguia ahi cuando termino el almuerzo": hasta el fin de la ventana, o
      // hasta su salida programada si es antes, con la tolerancia del horario.
      const mustStayUntil =
        Math.min(lunchWindow.end.getTime(), plannedShift ? plannedShift.end.getTime() : Infinity) - policy.toleranceMinutes * MINUTE_MS;
      const workedThroughLunch =
        checkIn.getTime() <= lunchWindow.start.getTime() &&
        checkOut.getTime() >= mustStayUntil &&
        checkOut.getTime() >= lunchWindow.start.getTime() + lunchMinutes * MINUTE_MS;
      if (!lunchFitsInShift || !workedThroughLunch) return fullDay;
      lunchStart = lunchWindow.start;
    } else if (plannedShift) {
      // La ventana configurada no cae dentro de este turno (ej. turno
      // nocturno sin ventana de almuerzo propia definida): se descuenta
      // cerca del final de la jornada como respaldo razonable -- pero solo si
      // la persona estuvo trabajando a mitad del turno, que es cuando se
      // asume la comida; a quien solo hizo una punta del turno no se le resta.
      // Un turno que ni siquiera es mas largo que el almuerzo no tiene comida que descontar.
      const plannedMinutes = (plannedShift.end.getTime() - plannedShift.start.getTime()) / MINUTE_MS;
      if (plannedMinutes <= policy.defaultLunchMinutes) return fullDay;
      const shiftMiddle = (plannedShift.start.getTime() + plannedShift.end.getTime()) / 2;
      const halfLunch = (lunchMinutes * MINUTE_MS) / 2;
      if (checkIn.getTime() > shiftMiddle - halfLunch || checkOut.getTime() < shiftMiddle + halfLunch) return fullDay;
      lunchStart = new Date(checkOut.getTime() - lunchMinutes * MINUTE_MS);
    } else {
      // Sin turno programado y sin haber trabajado a la hora de almuerzo.
      return fullDay;
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

/**
 * Quita de los intervalos trabajados las pausas automaticas (`breaks`) que la
 * persona no marca -- ej. la comida de un turno nocturno partido por dia
 * calendario, donde las marcas de "almuerzo" ya se usan para el descanso largo
 * del dia. Misma regla que el almuerzo automatico: solo se descuenta si la
 * persona estaba trabajando durante TODA la pausa (entro antes y seguia ahi
 * cuando termino).
 */
export function subtractAutomaticBreaks(
  segments: Array<{ start: Date; end: Date }>,
  breaks: Array<{ start: Date; end: Date }> | undefined,
): Array<{ start: Date; end: Date }> {
  if (!breaks || breaks.length === 0) return segments;
  let result = segments;
  for (const pause of breaks) {
    if (pause.end <= pause.start) continue;
    const next: Array<{ start: Date; end: Date }> = [];
    for (const segment of result) {
      if (segment.start <= pause.start && segment.end >= pause.end) {
        if (pause.start > segment.start) next.push({ start: segment.start, end: pause.start });
        if (segment.end > pause.end) next.push({ start: pause.end, end: segment.end });
      } else {
        next.push(segment);
      }
    }
    result = next;
  }
  return result;
}
