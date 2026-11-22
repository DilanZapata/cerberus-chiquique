/**
 * Planificador de rutina de ordeño POR ROLES. A diferencia de
 * `planMilkingRotation` (que reparte ordeñadores y vaqueros por equidad entre
 * todos), aqui cada persona tiene un puesto base y solo se mueve cuando hace
 * falta cubrir un hueco, tal como lo arma a mano la finca:
 *
 *  - ORDENADOR: ordeñador fijo de un ordeño. Se queda en el suyo.
 *  - RELEVO:    ordeñador con ordeño base, pero es el primero que cruza al
 *               otro ordeño cuando alla faltan manos.
 *  - VAQUERO:   vaquero fijo de la vaqueria de un ordeño. Su media jornada la
 *               hace ordeñando en ese mismo ordeño.
 *  - COMODIN:   sin puesto base. Cubre la vaqueria cuando el vaquero descansa
 *               o tiene media jornada, y si no, el ordeño que mas lo necesite.
 *
 * Todos (el comodin tambien) siguen el mismo ciclo personal de 14 dias que ya
 * usa el sistema: dia 0 media jornada, dia 1 descanso, dias 2-6 completos,
 * dias 7 y 8 descanso, dias 9-13 completos. Eso da 44 h una semana y 40 h la
 * otra (promedio 42).
 *
 * Cada ordeño necesita cada dia `ORDENADORES_PER_STATION` ordeñadores de
 * jornada completa y 1 vaquero. El dia de media jornada de cada persona puede
 * venir fijado (`shortDayOffset`) o lo escoge el planificador buscando que
 * ningun puesto quede sin cubrir.
 */
import { MILKING_CYCLE_LENGTH_DAYS, workerDayKindOnSharedDay } from './milking-rotation-planner';

const ORDENADORES_PER_STATION = 2;

export type MilkingRosterRole = 'ORDENADOR' | 'RELEVO' | 'VAQUERO' | 'COMODIN';
export type MilkingRosterPost = 'ORDENO' | 'VAQUERIA';

export interface MilkingRosterWorker {
  id: string;
  role: MilkingRosterRole;
  /** Ordeño base (0 = Ordeño 1). No aplica al comodin. */
  homeStation?: number;
  /** Dia (0..13) del ciclo compartido en que le toca la media jornada. Sin valor: lo escoge el planificador. */
  shortDayOffset?: number;
  /** false = renuncia a la media jornada (ese dia trabaja completo). */
  hasShortDay?: boolean;
  /** false = renuncia al segundo descanso de la semana larga de descanso. */
  hasWeekBSecondRest?: boolean;
}

export interface PlanMilkingRosterInput {
  stationsCount: number;
  workers: MilkingRosterWorker[];
}

export interface MilkingRosterCell {
  workerId: string;
  kind: 'DESCANSO' | 'COMPLETO' | 'CORTO';
  post?: MilkingRosterPost;
  /** Ordeño / vaqueria donde trabaja ese dia (0 = el 1). */
  station?: number;
  /** true si ese dia esta cubriendo un puesto que no es el suyo (otro ordeño, o vaqueria sin ser vaquero). */
  isCover: boolean;
}

export interface MilkingRosterGap {
  dayOffset: number;
  station: number;
  post: MilkingRosterPost;
  /** Cuantas personas faltan en ese puesto ese dia. */
  missing: number;
}

export interface MilkingRosterDay {
  dayOffset: number;
  cells: MilkingRosterCell[];
}

export interface MilkingRosterPlan {
  /** true si ningun puesto queda sin cubrir en los 14 dias. */
  feasible: boolean;
  cycleLengthDays: number;
  stationsCount: number;
  /** Dia del ciclo en que cada persona tiene su media jornada (o inicia su ciclo de descanso). */
  workerOffsets: Array<{ workerId: string; offset: number; chosenBySystem: boolean }>;
  days: MilkingRosterDay[];
  gaps: MilkingRosterGap[];
  /** Veces que alguien que no es vaquero ni comodin tuvo que cubrir una vaqueria. */
  vaqueriaCoversByOrdenadores: number;
  warnings: string[];
}

interface DayOutcome {
  cells: MilkingRosterCell[];
  gaps: MilkingRosterGap[];
  vaqueriaCoversByOrdenadores: number;
  crossings: number;
}

function homeOf(worker: MilkingRosterWorker, stationsCount: number): number {
  const home = worker.homeStation ?? 0;
  return Math.min(Math.max(0, home), stationsCount - 1);
}

/** Reparte los puestos de UN dia del ciclo, dados los offsets de todos. */
function assignDay(day: number, workers: MilkingRosterWorker[], offsets: number[], stationsCount: number): DayOutcome {
  const cells = new Map<string, MilkingRosterCell>();
  const gaps: MilkingRosterGap[] = [];
  let vaqueriaCoversByOrdenadores = 0;
  let crossings = 0;

  const vaquero: Array<MilkingRosterWorker | null> = Array.from({ length: stationsCount }, () => null);
  const ordeno: MilkingRosterWorker[][] = Array.from({ length: stationsCount }, () => []);
  const freeComodines: MilkingRosterWorker[] = [];
  const shortDay: MilkingRosterWorker[] = [];

  workers.forEach((worker, i) => {
    const kind = workerDayKindOnSharedDay(day, offsets[i], worker.hasShortDay !== false, worker.hasWeekBSecondRest !== false);
    if (kind === 'DESCANSO') {
      cells.set(worker.id, { workerId: worker.id, kind: 'DESCANSO', isCover: false });
      return;
    }
    if (kind === 'CORTO') {
      shortDay.push(worker);
      return;
    }
    if (worker.role === 'COMODIN') {
      freeComodines.push(worker);
      return;
    }
    const home = homeOf(worker, stationsCount);
    if (worker.role === 'VAQUERO' && !vaquero[home]) vaquero[home] = worker;
    else ordeno[home].push(worker); // ordeñador, relevo, o un segundo vaquero de la misma vaqueria
  });

  // Saca de un ordeño con gente de sobra a alguien que pueda cubrir en otro
  // lado: primero un relevo (es su papel), y si no hay, un ordeñador fijo.
  const takeFromSurplus = (excludeStation: number): MilkingRosterWorker | null => {
    for (const preferRole of ['RELEVO', 'ORDENADOR', 'VAQUERO'] as MilkingRosterRole[]) {
      let bestStation = -1;
      for (let s = 0; s < stationsCount; s++) {
        if (s === excludeStation || ordeno[s].length <= ORDENADORES_PER_STATION) continue;
        if (!ordeno[s].some((w) => w.role === preferRole)) continue;
        if (bestStation === -1 || ordeno[s].length > ordeno[bestStation].length) bestStation = s;
      }
      if (bestStation !== -1) {
        const index = ordeno[bestStation].findIndex((w) => w.role === preferRole);
        return ordeno[bestStation].splice(index, 1)[0];
      }
    }
    return null;
  };

  // 1) Vaquerias sin su vaquero (descansa o tiene media jornada): comodin; si
  //    no hay comodin libre, alguien que sobre en un ordeño.
  for (let s = 0; s < stationsCount; s++) {
    if (vaquero[s]) continue;
    const comodin = freeComodines.shift();
    if (comodin) {
      vaquero[s] = comodin;
      continue;
    }
    const cover = takeFromSurplus(-1);
    if (cover) {
      vaquero[s] = cover;
      vaqueriaCoversByOrdenadores++;
    } else {
      gaps.push({ dayOffset: day, station: s, post: 'VAQUERIA', missing: 1 });
    }
  }

  // 2) Ordeños con menos manos de las necesarias: cruza un relevo de un
  //    ordeño al que le sobre; si no, el comodin; si no, un ordeñador fijo.
  for (let s = 0; s < stationsCount; s++) {
    while (ordeno[s].length < ORDENADORES_PER_STATION) {
      const surplusRelevoExists = ordeno.some(
        (list, other) => other !== s && list.length > ORDENADORES_PER_STATION && list.some((w) => w.role === 'RELEVO'),
      );
      const cover = surplusRelevoExists ? takeFromSurplus(s) : freeComodines.shift() ?? takeFromSurplus(s);
      if (!cover) break;
      ordeno[s].push(cover);
    }
    if (ordeno[s].length < ORDENADORES_PER_STATION) {
      gaps.push({ dayOffset: day, station: s, post: 'ORDENO', missing: ORDENADORES_PER_STATION - ordeno[s].length });
    }
  }

  // 3) Comodin que nadie necesito: al ordeño con menos manos.
  for (const comodin of freeComodines) {
    let target = 0;
    for (let s = 1; s < stationsCount; s++) if (ordeno[s].length < ordeno[target].length) target = s;
    ordeno[target].push(comodin);
  }

  // 4) Si un ordeño quedo con 2 o mas personas por encima de otro, se
  //    empareja moviendo un relevo (los fijos no se mueven por esto).
  for (let guard = 0; guard < workers.length; guard++) {
    let max = 0;
    let min = 0;
    for (let s = 1; s < stationsCount; s++) {
      if (ordeno[s].length > ordeno[max].length) max = s;
      if (ordeno[s].length < ordeno[min].length) min = s;
    }
    if (ordeno[max].length - ordeno[min].length < 2) break;
    const index = ordeno[max].findIndex((w) => w.role === 'RELEVO' || w.role === 'COMODIN');
    if (index === -1) break;
    ordeno[min].push(ordeno[max].splice(index, 1)[0]);
  }

  for (let s = 0; s < stationsCount; s++) {
    const v = vaquero[s];
    if (v) {
      const isCover = v.role !== 'COMODIN' && !(v.role === 'VAQUERO' && homeOf(v, stationsCount) === s);
      cells.set(v.id, { workerId: v.id, kind: 'COMPLETO', post: 'VAQUERIA', station: s, isCover });
    }
    for (const w of ordeno[s]) {
      const isCover = w.role !== 'COMODIN' && homeOf(w, stationsCount) !== s;
      if (isCover) crossings++;
      cells.set(w.id, { workerId: w.id, kind: 'COMPLETO', post: 'ORDENO', station: s, isCover });
    }
  }

  // 5) Medias jornadas: un solo ordeño (4 h). Cada quien en su ordeño base;
  //    el comodin, donde haya menos manos.
  const halfCount = Array.from({ length: stationsCount }, () => 0);
  for (const worker of shortDay) {
    let station: number;
    if (worker.role === 'COMODIN') {
      station = 0;
      for (let s = 1; s < stationsCount; s++) {
        if (ordeno[s].length + halfCount[s] / 2 < ordeno[station].length + halfCount[station] / 2) station = s;
      }
    } else {
      station = homeOf(worker, stationsCount);
    }
    halfCount[station]++;
    cells.set(worker.id, { workerId: worker.id, kind: 'CORTO', post: 'ORDENO', station, isCover: false });
  }

  return {
    cells: workers.map((w) => cells.get(w.id)!),
    gaps,
    vaqueriaCoversByOrdenadores,
    crossings,
  };
}

interface CycleOutcome {
  days: DayOutcome[];
  /** Menor es mejor, en este orden: puestos sin cubrir, ordeñadores haciendo de vaquero, cruces de ordeño. */
  score: [number, number, number];
}

function evaluateCycle(workers: MilkingRosterWorker[], offsets: number[], stationsCount: number): CycleOutcome {
  const days: DayOutcome[] = [];
  const score: [number, number, number] = [0, 0, 0];
  for (let day = 0; day < MILKING_CYCLE_LENGTH_DAYS; day++) {
    const outcome = assignDay(day, workers, offsets, stationsCount);
    days.push(outcome);
    score[0] += outcome.gaps.reduce((sum, gap) => sum + gap.missing, 0);
    score[1] += outcome.vaqueriaCoversByOrdenadores;
    score[2] += outcome.crossings;
  }
  return { days, score };
}

function isBetter(a: [number, number, number], b: [number, number, number]): boolean {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] < b[i];
  }
  return false;
}

/**
 * Escoge el dia de media jornada de quienes no lo traen fijado. Parte de
 * varios repartos iniciales y mejora de a una persona (probando todos sus
 * dias posibles) hasta que ya no se pueda mejorar; se queda con el mejor.
 * Primero intenta con la media jornada en la primera semana del ciclo (asi
 * todos tienen su semana de 44 h a la vez, como en la planilla manual) y solo
 * si no alcanza prueba los 14 dias.
 */
function chooseOffsets(workers: MilkingRosterWorker[], stationsCount: number): number[] {
  const fixed = workers.map((w) =>
    w.shortDayOffset === undefined ? null : ((w.shortDayOffset % MILKING_CYCLE_LENGTH_DAYS) + MILKING_CYCLE_LENGTH_DAYS) % MILKING_CYCLE_LENGTH_DAYS,
  );
  const freeIndexes = workers.map((_, i) => i).filter((i) => fixed[i] === null);
  if (freeIndexes.length === 0) return fixed.map((offset) => offset!);

  let best: number[] | null = null;
  let bestScore: [number, number, number] = [Infinity, Infinity, Infinity];

  for (const range of [7, MILKING_CYCLE_LENGTH_DAYS]) {
    for (let start = 0; start < range; start++) {
      for (const step of [1, 2, 3]) {
        const offsets = fixed.map((offset) => offset ?? 0);
        freeIndexes.forEach((workerIndex, position) => {
          offsets[workerIndex] = (start + position * step) % range;
        });
        let score = evaluateCycle(workers, offsets, stationsCount).score;

        for (let round = 0; round < 12; round++) {
          let improved = false;
          for (const workerIndex of freeIndexes) {
            const original = offsets[workerIndex];
            let bestCandidate = original;
            for (let candidate = 0; candidate < range; candidate++) {
              if (candidate === original) continue;
              offsets[workerIndex] = candidate;
              const candidateScore = evaluateCycle(workers, offsets, stationsCount).score;
              if (isBetter(candidateScore, score)) {
                score = candidateScore;
                bestCandidate = candidate;
                improved = true;
              }
            }
            offsets[workerIndex] = bestCandidate;
          }
          if (!improved) break;
        }

        if (isBetter(score, bestScore)) {
          bestScore = score;
          best = [...offsets];
        }
      }
    }
    if (bestScore[0] === 0) break; // ya cubre todos los puestos sin salir de la primera semana
  }

  return best!;
}

export function planMilkingRoster(input: PlanMilkingRosterInput): MilkingRosterPlan {
  const stationsCount = Math.max(1, Math.floor(input.stationsCount || 1));
  const workers = input.workers;
  const warnings: string[] = [];

  if (workers.length === 0) {
    return {
      feasible: false,
      cycleLengthDays: MILKING_CYCLE_LENGTH_DAYS,
      stationsCount,
      workerOffsets: [],
      days: [],
      gaps: [],
      vaqueriaCoversByOrdenadores: 0,
      warnings: ['No se proporcionaron trabajadores.'],
    };
  }

  for (let s = 0; s < stationsCount; s++) {
    const atStation = workers.filter((w) => w.role !== 'COMODIN' && homeOf(w, stationsCount) === s);
    const ordenadores = atStation.filter((w) => w.role === 'ORDENADOR' || w.role === 'RELEVO').length;
    if (!atStation.some((w) => w.role === 'VAQUERO')) warnings.push(`El Ordeño ${s + 1} no tiene vaquero fijo.`);
    if (ordenadores < ORDENADORES_PER_STATION) {
      warnings.push(`El Ordeño ${s + 1} tiene ${ordenadores} ordeñador(es) de base y necesita ${ORDENADORES_PER_STATION} cada dia.`);
    }
  }

  const offsets = chooseOffsets(workers, stationsCount);
  const outcome = evaluateCycle(workers, offsets, stationsCount);
  const gaps = outcome.days.flatMap((day) => day.gaps);

  return {
    feasible: gaps.length === 0,
    cycleLengthDays: MILKING_CYCLE_LENGTH_DAYS,
    stationsCount,
    workerOffsets: workers.map((w, i) => ({ workerId: w.id, offset: offsets[i], chosenBySystem: w.shortDayOffset === undefined })),
    days: outcome.days.map((day, dayOffset) => ({ dayOffset, cells: day.cells })),
    gaps,
    vaqueriaCoversByOrdenadores: outcome.score[1],
    warnings,
  };
}
