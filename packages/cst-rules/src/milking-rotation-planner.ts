/**
 * Planificador de rutinas de ordeño: jornada especial de ordeñadores con
 * ciclo de descanso quincenal (14 dias) por trabajador, mas un rol diario de
 * "vaquero" que rota entre los mismos trabajadores. Puede haber varios
 * ordeños (estaciones) simultaneos; CADA ordeño requiere 2 ordeñadores + 1
 * vaquero disponibles ese dia, asi que 2 ordeños necesitan 4 ordeñadores +
 * 2 vaqueros, etc.
 *
 * Ciclo individual ESTANDAR de 14 dias (posiciones relativas al ancla de
 * cada trabajador):
 *   dia 0: jornada corta (ordeño de la manana, ~4h) y descansa el resto del dia.
 *   dia 1: descanso completo.
 *   dias 2-6: jornada completa (ordeño manana + tarde).
 *   dia 7: descanso completo.
 *   dia 8: descanso completo.
 *   dias 9-13: jornada completa.
 *
 * Un trabajador puede renunciar, de forma independiente, a dos beneficios de
 * ese ciclo (ver `fullDayWorkerIds` / `reducedRestWorkerIds`):
 *  - Dia corto (dia 0): si renuncia, ese dia trabaja jornada completa.
 *  - Segundo descanso de la semana B (dia 8): si renuncia, ese dia tambien
 *    trabaja completo, quedando solo con 1 descanso por semana (dias 1 y 7).
 *
 * El sistema escalona el "dia 0" de cada trabajador (su ancla dentro del
 * ciclo compartido) buscando, mediante una construccion voraz, la
 * combinacion que maximiza cuantos trabajadores quedan disponibles el peor
 * dia del ciclo. Si ni siquiera con todos los trabajadores dados se llega al
 * minimo de 3*ordeños disponibles todos los dias, reporta cuantos
 * trabajadores mas hacen falta en total, Y ADEMAS calcula (de forma voraz)
 * a quienes convendria quitarles el dia corto y/o el segundo descanso de la
 * semana B para que alcance con el MISMO equipo, sin contratar a nadie mas.
 */

export const MILKING_CYCLE_LENGTH_DAYS = 14;
const SHORT_DAY_OFFSET = 0;
const WEEK_B_SECOND_REST_OFFSET = 8;
const ALWAYS_REST_OFFSETS = new Set([1, 7]);
const ROLES_PER_STATION = 3; // 2 ordeñadores + 1 vaquero

export type MilkingDayKind = 'CORTO' | 'DESCANSO' | 'DISPONIBLE';

function personalDayKind(offsetInCycle: number, hasShortDay: boolean, hasWeekBSecondRest: boolean): MilkingDayKind {
  if (hasShortDay && offsetInCycle === SHORT_DAY_OFFSET) return 'CORTO';
  if (ALWAYS_REST_OFFSETS.has(offsetInCycle)) return 'DESCANSO';
  if (hasWeekBSecondRest && offsetInCycle === WEEK_B_SECOND_REST_OFFSET) return 'DESCANSO';
  return 'DISPONIBLE';
}

function relativeOffset(day: number, anchorOffset: number): number {
  return ((day - anchorOffset) % MILKING_CYCLE_LENGTH_DAYS + MILKING_CYCLE_LENGTH_DAYS) % MILKING_CYCLE_LENGTH_DAYS;
}

/** Que tipo de dia le toca a un trabajador (por su offset personal) en un dia dado del ciclo compartido. */
export function workerDayKindOnSharedDay(
  sharedDay: number,
  workerOffset: number,
  hasShortDay = true,
  hasWeekBSecondRest = true,
): MilkingDayKind {
  return personalDayKind(relativeOffset(sharedDay, workerOffset), hasShortDay, hasWeekBSecondRest);
}

/** Cuenta, para un dia dado del ciclo, cuantos trabajadores estan DISPONIBLE ese dia. */
function availableCountForDay(
  day: number,
  offsets: number[],
  hasShortDayFlags: boolean[],
  hasWeekBSecondRestFlags: boolean[],
  hasComodin: boolean,
): number {
  let count = hasComodin ? 1 : 0;
  for (let i = 0; i < offsets.length; i++) {
    if (personalDayKind(relativeOffset(day, offsets[i]), hasShortDayFlags[i], hasWeekBSecondRestFlags[i]) === 'DISPONIBLE') count++;
  }
  return count;
}

/** El disponible minimo a lo largo de los 14 dias del ciclo, para un conjunto de offsets ya elegido. */
function minAvailableAcrossCycle(
  offsets: number[],
  hasShortDayFlags: boolean[],
  hasWeekBSecondRestFlags: boolean[],
  hasComodin: boolean,
): number {
  let min = Infinity;
  for (let day = 0; day < MILKING_CYCLE_LENGTH_DAYS; day++) {
    min = Math.min(min, availableCountForDay(day, offsets, hasShortDayFlags, hasWeekBSecondRestFlags, hasComodin));
  }
  return min;
}

/**
 * Construccion voraz: agrega trabajadores uno a uno, eligiendo en cada paso
 * el offset (0-13) que maximiza el disponible minimo resultante. Evita el
 * problema de un espaciado uniforme "ciego", que puede hacer coincidir por
 * simetria los dias de descanso de dos trabajadores distintos.
 */
function chooseOffsets(hasShortDayFlags: boolean[], hasWeekBSecondRestFlags: boolean[], hasComodin: boolean): number[] {
  const offsets: number[] = [];
  for (let k = 0; k < hasShortDayFlags.length; k++) {
    let bestOffset = 0;
    let bestMin = -Infinity;
    for (let candidate = 0; candidate < MILKING_CYCLE_LENGTH_DAYS; candidate++) {
      const trialOffsets = [...offsets, candidate];
      const min = minAvailableAcrossCycle(
        trialOffsets,
        hasShortDayFlags.slice(0, trialOffsets.length),
        hasWeekBSecondRestFlags.slice(0, trialOffsets.length),
        hasComodin,
      );
      if (min > bestMin) {
        bestMin = min;
        bestOffset = candidate;
      }
    }
    offsets.push(bestOffset);
  }
  return offsets;
}

/**
 * Busca cuales trabajadores del equipo dado (sin agregar a nadie) convendria
 * pasar a jornada completa: primero probando quitarles solo el dia corto
 * (uno a uno, en el orden dado, deteniendose apenas alcance), y si con eso
 * no alcanza ni quitandoselo a todos, tambien quitandoles el segundo
 * descanso de la semana B (uno a uno) hasta lograrlo o agotar a todos.
 *
 * Quitar una restriccion nunca empeora el resultado (monotono: mas dias
 * disponibles para un trabajador solo puede igualar o mejorar el peor dia
 * del ciclo), asi que esta busqueda secuencial siempre converge si la
 * combinacion "todos sin dia corto y sin 2do descanso" alcanza a cubrir el
 * minimo exigido.
 */
function suggestScheduleReduction(
  workerIds: string[],
  hasComodin: boolean,
  minAvailablePerDay: number,
): { possible: boolean; noShortDayWorkerIds: string[]; reducedRestWorkerIds: string[] } {
  const shortFlags = workerIds.map(() => true);
  const restFlags = workerIds.map(() => true);

  const currentWorst = () => {
    const offsets = chooseOffsets(shortFlags, restFlags, hasComodin);
    return minAvailableAcrossCycle(offsets, shortFlags, restFlags, hasComodin);
  };

  const noShortDayWorkerIds: string[] = [];
  for (let i = 0; i < workerIds.length && currentWorst() < minAvailablePerDay; i++) {
    shortFlags[i] = false;
    noShortDayWorkerIds.push(workerIds[i]);
  }

  const reducedRestWorkerIds: string[] = [];
  for (let i = 0; i < workerIds.length && currentWorst() < minAvailablePerDay; i++) {
    restFlags[i] = false;
    reducedRestWorkerIds.push(workerIds[i]);
  }

  return { possible: currentWorst() >= minAvailablePerDay, noShortDayWorkerIds, reducedRestWorkerIds };
}

export interface PlanMilkingRotationInput {
  /** Trabajadores sujetos al ciclo de descanso quincenal (sin incluir al comodin). */
  workerIds: string[];
  /** Trabajador comodin opcional: siempre disponible, sin ciclo de descanso propio, cubre huecos de ordeño o vaqueria. */
  comodinWorkerId?: string;
  /** Cantidad de ordeños (estaciones) simultaneos que se atienden cada dia. Cada uno necesita 2 ordeñadores + 1 vaquero. Default 1. */
  stationsCount?: number;
  /** Trabajadores (de workerIds) que renuncian a su dia corto: trabajan jornada completa tambien ese dia. */
  fullDayWorkerIds?: string[];
  /** Trabajadores (de workerIds) que renuncian al segundo descanso de la semana B: solo descansan 1 dia por semana. */
  reducedRestWorkerIds?: string[];
  /**
   * Vaqueros fijos, uno por ordeño (indice = stationIndex). Ese trabajador
   * hace de vaquero en esa estacion todos los dias que este disponible; los
   * dias que le toque descansar o dia corto, se elige un reemplazo entre los
   * demas disponibles ese dia (rotando el reemplazo con equidad).
   */
  vaqueroWorkerIds?: string[];
}

export interface MilkingStationAssignment {
  stationIndex: number; // 0-based
  ordenadores: string[]; // exactamente 2
  vaquero: string;
  /** true si el vaquero fijo de esta estacion no estaba disponible y este es un reemplazo. */
  isVaqueroSubstitute: boolean;
}

export interface MilkingDayAssignment {
  dayOffset: number; // 0..13, dia dentro del ciclo compartido
  stations: MilkingStationAssignment[];
  workersOnShortDay: string[];
  workersResting: string[];
}

export interface WorkerMilkingOffset {
  workerId: string;
  offset: number; // 0..13
}

export interface MilkingRotationPlanResult {
  feasible: boolean;
  cycleLengthDays: number;
  stationsCount: number;
  workerOffsets: WorkerMilkingOffset[];
  days: MilkingDayAssignment[];
  warnings: string[];
  /** Solo si !feasible: total de trabajadores (sin contar al comodin) que se necesitarian, manteniendo el ciclo estandar para todos, para que la rotacion funcione todos los dias. */
  minimumWorkersNeeded?: number;
  /** Solo si !feasible: si alcanza con el MISMO equipo quitandole el dia corto a estos trabajadores (sin contratar a nadie mas, sin tocar sus descansos). */
  suggestedFullDayWorkerIds?: string[];
  /** Solo si !feasible y lo anterior no alcanzo: alcanza quitandole ADEMAS el segundo descanso de la semana B a estos trabajadores (quedan con 1 solo descanso semanal). */
  suggestedReducedRestWorkerIds?: string[];
}

export function planMilkingRotation(input: PlanMilkingRotationInput): MilkingRotationPlanResult {
  const stationsCount = Math.max(1, input.stationsCount ?? 1);
  const minAvailablePerDay = stationsCount * ROLES_PER_STATION;
  const regularWorkers = input.workerIds.filter((id) => id !== input.comodinWorkerId);
  const hasComodin = !!input.comodinWorkerId;
  const fullDaySet = new Set(input.fullDayWorkerIds ?? []);
  const reducedRestSet = new Set(input.reducedRestWorkerIds ?? []);
  const hasShortDayFlags = regularWorkers.map((id) => !fullDaySet.has(id));
  const hasWeekBSecondRestFlags = regularWorkers.map((id) => !reducedRestSet.has(id));
  const n = regularWorkers.length;

  if (n === 0) {
    return {
      feasible: false,
      cycleLengthDays: MILKING_CYCLE_LENGTH_DAYS,
      stationsCount,
      workerOffsets: [],
      days: [],
      warnings: ['No se proporcionaron trabajadores.'],
    };
  }

  const offsets = chooseOffsets(hasShortDayFlags, hasWeekBSecondRestFlags, hasComodin);
  const worstCase = minAvailableAcrossCycle(offsets, hasShortDayFlags, hasWeekBSecondRestFlags, hasComodin);

  if (worstCase < minAvailablePerDay) {
    // 1) Busca el minimo N adicional (todos con el ciclo estandar) hasta que
    //    la rotacion sea viable todos los dias del ciclo.
    let candidateN = n;
    let candidateWorst = worstCase;
    while (candidateWorst < minAvailablePerDay && candidateN < 200) {
      candidateN++;
      const allStandardShort = Array(candidateN).fill(true);
      const allStandardRest = Array(candidateN).fill(true);
      const candidateOffsets = chooseOffsets(allStandardShort, allStandardRest, hasComodin);
      candidateWorst = minAvailableAcrossCycle(candidateOffsets, allStandardShort, allStandardRest, hasComodin);
    }

    // 2) Alternativa sin contratar a nadie mas: quitarle el dia corto (y, si
    //    con eso no alcanza, tambien el 2do descanso de semana B) a algunos.
    const suggestion = suggestScheduleReduction(regularWorkers, hasComodin, minAvailablePerDay);

    return {
      feasible: false,
      cycleLengthDays: MILKING_CYCLE_LENGTH_DAYS,
      stationsCount,
      workerOffsets: [],
      days: [],
      warnings: [
        `Trabajadores insuficientes: con ${n} trabajador(es)${hasComodin ? ' + comodin' : ''} el minimo de personal disponible cae a ${worstCase} en el peor dia del ciclo de 14 dias. Con ${stationsCount} ordeño(s) se necesitan al menos ${minAvailablePerDay} disponibles cada dia (2 ordeñadores + 1 vaquero por ordeño). Se necesitan al menos ${candidateN} trabajadores en el ciclo de descanso${hasComodin ? ' (ademas del comodin)' : ''} para que la rotacion funcione todos los dias.`,
      ],
      minimumWorkersNeeded: candidateN,
      suggestedFullDayWorkerIds: suggestion.possible ? suggestion.noShortDayWorkerIds : undefined,
      suggestedReducedRestWorkerIds: suggestion.possible ? suggestion.reducedRestWorkerIds : undefined,
    };
  }

  const vaqueroCount = new Map<string, number>();
  const ordenadorCount = new Map<string, number>();
  const allWorkerIds = hasComodin ? [...regularWorkers, input.comodinWorkerId!] : regularWorkers;
  for (const id of allWorkerIds) {
    vaqueroCount.set(id, 0);
    ordenadorCount.set(id, 0);
  }

  const workerOffsets: WorkerMilkingOffset[] = regularWorkers.map((workerId, i) => ({ workerId, offset: offsets[i] }));
  const shortDayByWorker = new Map(regularWorkers.map((id, i) => [id, hasShortDayFlags[i]]));
  const secondRestByWorker = new Map(regularWorkers.map((id, i) => [id, hasWeekBSecondRestFlags[i]]));
  const days: MilkingDayAssignment[] = [];

  for (let day = 0; day < MILKING_CYCLE_LENGTH_DAYS; day++) {
    const available: string[] = hasComodin ? [input.comodinWorkerId!] : [];
    const workersOnShortDay: string[] = [];
    const workersResting: string[] = [];

    for (const { workerId, offset } of workerOffsets) {
      const kind = personalDayKind(relativeOffset(day, offset), shortDayByWorker.get(workerId)!, secondRestByWorker.get(workerId)!);
      if (kind === 'DISPONIBLE') available.push(workerId);
      else if (kind === 'CORTO') workersOnShortDay.push(workerId);
      else workersResting.push(workerId);
    }

    const used = new Set<string>();
    const stationVaquero: Array<{ vaquero: string; isVaqueroSubstitute: boolean }> = [];

    // Fase 1: reservar, para cada estacion, su vaquero fijo si esta
    // disponible hoy. Se hace ANTES de asignar ordeñadores para que un
    // vaquero fijo de otra estacion no se lo lleve un turno de ordeño.
    for (let s = 0; s < stationsCount; s++) {
      const designatedVaquero = input.vaqueroWorkerIds?.[s];
      if (designatedVaquero && available.includes(designatedVaquero) && !used.has(designatedVaquero)) {
        used.add(designatedVaquero);
        stationVaquero[s] = { vaquero: designatedVaquero, isVaqueroSubstitute: false };
      }
    }

    // Fase 2: a las estaciones que se quedaron sin vaquero fijo disponible
    // (no definido, descansando, o en dia corto) se les asigna un reemplazo,
    // repartiendo esa carga extra con equidad entre los disponibles.
    for (let s = 0; s < stationsCount; s++) {
      if (stationVaquero[s]) continue;
      const remaining = available.filter((id) => !used.has(id));
      const sortedForVaquero = remaining.sort((a, b) => {
        const byVaquero = vaqueroCount.get(a)! - vaqueroCount.get(b)!;
        if (byVaquero !== 0) return byVaquero;
        return ordenadorCount.get(a)! - ordenadorCount.get(b)!;
      });
      const substitute = sortedForVaquero[0];
      used.add(substitute);
      stationVaquero[s] = { vaquero: substitute, isVaqueroSubstitute: !!input.vaqueroWorkerIds?.[s] };
    }

    const stations: MilkingStationAssignment[] = [];
    for (let s = 0; s < stationsCount; s++) {
      const { vaquero, isVaqueroSubstitute } = stationVaquero[s];
      vaqueroCount.set(vaquero, vaqueroCount.get(vaquero)! + 1);

      const ordenadoresSorted = available
        .filter((id) => !used.has(id))
        .sort((a, b) => ordenadorCount.get(a)! - ordenadorCount.get(b)!);
      const ordenadores = ordenadoresSorted.slice(0, 2);
      ordenadores.forEach((id) => {
        used.add(id);
        ordenadorCount.set(id, ordenadorCount.get(id)! + 1);
      });

      stations.push({ stationIndex: s, ordenadores, vaquero, isVaqueroSubstitute });
    }

    days.push({ dayOffset: day, stations, workersOnShortDay, workersResting });
  }

  return {
    feasible: true,
    cycleLengthDays: MILKING_CYCLE_LENGTH_DAYS,
    stationsCount,
    workerOffsets,
    days,
    warnings: [],
  };
}
