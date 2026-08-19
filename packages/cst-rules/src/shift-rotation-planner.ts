/**
 * Planificador de rutinas rotativas: dado un numero de trabajadores y una
 * ventana de cobertura (ej. 06:00-22:00), calcula automaticamente cuantos
 * turnos concurrentes hacen falta, asigna cada trabajador a un turno fijo
 * (o a una rotacion equitativa si hay mas trabajadores que turnos) y
 * escalona los dias de descanso para no dejar toda la cobertura de un turno
 * vacia el mismo dia.
 *
 * Ejemplo: 2 trabajadores, cobertura 06:00-22:00 (16h), turnos de 8h ->
 * 2 turnos exactos (06:00-14:00 y 14:00-22:00), un trabajador fijo por
 * turno, cada uno descansando un dia distinto de la semana.
 */

export type RotationTypeLabel = 'DIURNO' | 'NOCTURNO' | 'MIXTO';

export interface RotationSlot {
  index: number;
  startTime: string; // "HH:mm"
  endTime: string; // "HH:mm"
  rotationType: RotationTypeLabel;
}

export interface WorkerDayPlan {
  dayOffset: number;
  isRestDay: boolean;
  slotIndex?: number;
}

export interface WorkerRotationPlan {
  workerId: string;
  /** Turno principal del trabajador (el que cubre la mayoria de sus dias laborados). */
  primarySlotIndex: number;
  days: WorkerDayPlan[];
}

export interface RotationPlanResult {
  slots: RotationSlot[];
  cycleLengthDays: number;
  warnings: string[];
  workerPlans: WorkerRotationPlan[];
}

export interface PlanShiftRotationInput {
  workerIds: string[];
  /** Hora de inicio de la ventana de cobertura, "HH:mm". */
  coverageStart: string;
  /** Hora de fin de la ventana de cobertura, "HH:mm". Puede cruzar medianoche (ej. 22:00 -> 06:00). */
  coverageEnd: string;
  /** Duracion de cada turno en horas (ej. 8). */
  shiftHours: number;
  /** Largo del ciclo en dias. Default 7 (una semana). */
  cycleLengthDays?: number;
  /** Dias de descanso por semana quer cada trabajador debe tener, cuando no le vienen dados por la rotacion misma. Default 1. */
  restDaysPerWeek?: number;
}

function parseHHmm(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function formatMinutes(totalMinutes: number): string {
  const normalized = ((totalMinutes % 1440) + 1440) % 1440;
  const h = Math.floor(normalized / 60);
  const m = normalized % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function isDayMinute(minute: number): boolean {
  const m = ((minute % 1440) + 1440) % 1440;
  return m >= 6 * 60 && m < 19 * 60;
}

function classifyRotationType(startMinutes: number, endMinutes: number): RotationTypeLabel {
  const startIsDay = isDayMinute(startMinutes);
  const endIsDay = isDayMinute(endMinutes - 1);
  if (startIsDay && endIsDay) return 'DIURNO';
  if (!startIsDay && !endIsDay) return 'NOCTURNO';
  return 'MIXTO';
}

/** Divide la ventana de cobertura en turnos consecutivos de igual duracion. */
export function computeCoverageSlots(coverageStart: string, coverageEnd: string, shiftHours: number): RotationSlot[] {
  const startMin = parseHHmm(coverageStart);
  let endMin = parseHHmm(coverageEnd);
  if (endMin <= startMin) endMin += 24 * 60;

  const totalMinutes = endMin - startMin;
  const shiftMinutes = Math.max(1, shiftHours * 60);
  const numSlots = Math.max(1, Math.round(totalMinutes / shiftMinutes));
  const slotMinutes = totalMinutes / numSlots;

  const slots: RotationSlot[] = [];
  for (let i = 0; i < numSlots; i++) {
    const slotStart = startMin + i * slotMinutes;
    const slotEnd = startMin + (i + 1) * slotMinutes;
    slots.push({
      index: i,
      startTime: formatMinutes(slotStart),
      endTime: formatMinutes(slotEnd),
      rotationType: classifyRotationType(slotStart, slotEnd),
    });
  }
  return slots;
}

/**
 * Calcula el plan completo: a que turno queda cada trabajador y en que dias
 * del ciclo descansa. Si hay mas trabajadores que turnos, los agrupa por
 * turno y los rota dia a dia (round-robin) para que la cobertura este
 * siempre asegurada mientras todos comparten el descanso.
 */
export function planShiftRotation(input: PlanShiftRotationInput): RotationPlanResult {
  const cycleLengthDays = input.cycleLengthDays ?? 7;
  const restDaysPerWeek = input.restDaysPerWeek ?? 1;
  const slots = computeCoverageSlots(input.coverageStart, input.coverageEnd, input.shiftHours);
  const numSlots = slots.length;
  const warnings: string[] = [];

  if (input.workerIds.length === 0) {
    return { slots, cycleLengthDays, warnings: ['No se proporcionaron trabajadores.'], workerPlans: [] };
  }

  if (input.workerIds.length < numSlots) {
    warnings.push(
      `La ventana de cobertura necesita ${numSlots} turno(s) simultaneos, pero solo hay ${input.workerIds.length} trabajador(es); quedaran turnos sin cubrir todos los dias.`,
    );
  }

  const groups: string[][] = Array.from({ length: numSlots }, () => []);
  input.workerIds.forEach((workerId, idx) => {
    groups[idx % numSlots].push(workerId);
  });

  const workerPlans: WorkerRotationPlan[] = [];

  groups.forEach((group, slotIndex) => {
    const groupSize = group.length;
    group.forEach((workerId, posInGroup) => {
      const days: WorkerDayPlan[] = [];
      for (let d = 0; d < cycleLengthDays; d++) {
        // Si el turno tiene mas de un trabajador, se turnan dia a dia: solo
        // uno de ellos trabaja ese turno cada dia, el resto descansa.
        const isRestDay = groupSize > 1 && d % groupSize !== posInGroup;
        days.push({ dayOffset: d, isRestDay, slotIndex: isRestDay ? undefined : slotIndex });
      }

      // Con un solo trabajador por turno no hay rotacion inherente: se le
      // asignan dias de descanso explicitos, escalonados por trabajador para
      // que no todos descansen el mismo dia.
      if (groupSize === 1 && restDaysPerWeek > 0) {
        const globalIndex = input.workerIds.indexOf(workerId);
        const stride = Math.max(1, Math.floor(cycleLengthDays / Math.max(1, restDaysPerWeek)));
        for (let r = 0; r < restDaysPerWeek; r++) {
          const restOffset = (globalIndex + r * stride) % cycleLengthDays;
          const dayPlan = days[restOffset];
          if (dayPlan) {
            dayPlan.isRestDay = true;
            dayPlan.slotIndex = undefined;
          }
        }
      }

      workerPlans.push({ workerId, primarySlotIndex: slotIndex, days });
    });
  });

  return { slots, cycleLengthDays, warnings, workerPlans };
}
