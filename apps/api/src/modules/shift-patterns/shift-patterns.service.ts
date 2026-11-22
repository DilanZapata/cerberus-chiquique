import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  planShiftRotation,
  planMilkingRotation,
  planMilkingRoster,
  workerDayKindOnSharedDay,
  MILKING_CYCLE_LENGTH_DAYS,
  MilkingRosterCell,
} from '@cerberus/cst-rules';
import { PrismaService } from '../../database/prisma.service';
import { addDays, combineDateAndTime, daysBetween, hhmmToTime } from '../../common/utils/time.util';
import { CreateShiftPatternDto } from './dto/create-shift-pattern.dto';
import { AssignPatternToTeamDto, AssignPatternToUserDto } from './dto/assign-pattern.dto';
import { SmartGenerateShiftPatternDto } from './dto/smart-generate.dto';
import { SmartGenerateMilkingDto } from './dto/smart-generate-milking.dto';
import { MilkingRosterDto } from './dto/milking-roster.dto';

const ROLE_LABELS: Record<string, string> = {
  ORDENADOR: 'Ordeñador',
  VAQUERO: 'Vaquero',
};

const GENERATION_HORIZON_WEEKS = 4;

/** Texto del puesto de un dia de la rutina de ordeño por roles (se guarda en la plantilla y en el turno). */
function milkingPostLabel(cell: MilkingRosterCell): string | null {
  if (cell.kind === 'DESCANSO' || cell.station === undefined) return null;
  const number = cell.station + 1;
  if (cell.kind === 'CORTO') return `Ordeñador (Ordeño ${number}) · media jornada`;
  const base = cell.post === 'VAQUERIA' ? `Vaquero (Vaquería ${number})` : `Ordeñador (Ordeño ${number})`;
  return cell.isCover ? `${base} · cubre` : base;
}

/** Lee de vuelta el puesto guardado por `milkingPostLabel` (para mostrar una rutina ya creada). */
function parseMilkingPostLabel(notes: string | null): { post: 'ORDENO' | 'VAQUERIA'; station: number; isCover: boolean; isShortDay: boolean } | null {
  const match = notes?.match(/^(Ordeñador|Vaquero) \((?:Ordeño|Vaquería) (\d+)\)(.*)$/);
  if (!match) return null;
  return {
    post: match[1] === 'Vaquero' ? 'VAQUERIA' : 'ORDENO',
    station: Number(match[2]) - 1,
    isCover: match[3].includes('cubre'),
    isShortDay: match[3].includes('media jornada'),
  };
}

function toDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

@Injectable()
export class ShiftPatternsService {
  private readonly logger = new Logger(ShiftPatternsService.name);

  constructor(private readonly prisma: PrismaService) {}

  listPatterns(companyId: string) {
    return this.prisma.shiftPattern.findMany({
      where: { companyId },
      include: { days: { orderBy: { dayOffset: 'asc' } } },
      orderBy: { name: 'asc' },
    });
  }

  createPattern(companyId: string, dto: CreateShiftPatternDto) {
    return this.prisma.shiftPattern.create({
      data: {
        companyId,
        name: dto.name,
        cycleLengthDays: dto.cycleLengthDays,
        days: {
          create: dto.days.map((day) => ({
            dayOffset: day.dayOffset,
            isRestDay: day.isRestDay,
            rotationType: day.rotationType,
            startTime: day.isRestDay || !day.startTime ? null : hhmmToTime(day.startTime),
            endTime: day.isRestDay || !day.endTime ? null : hhmmToTime(day.endTime),
            lunchMinutes: day.lunchMinutes ?? 60,
          })),
        },
      },
      include: { days: true },
    });
  }

  /**
   * Genera automaticamente la mejor rutina posible: calcula cuantos turnos
   * concurrentes hacen falta para cubrir la ventana solicitada, asigna cada
   * trabajador a un turno (o los rota si hay mas gente que turnos) y
   * escalona los descansos. Crea una plantilla por trabajador (cada uno
   * puede tener un patron de descanso distinto) y materializa los turnos
   * concretos para las proximas semanas.
   */
  async smartGenerate(companyId: string, dto: SmartGenerateShiftPatternDto) {
    const plan = planShiftRotation({
      workerIds: dto.workerIds,
      coverageStart: dto.coverageStart,
      coverageEnd: dto.coverageEnd,
      shiftHours: dto.shiftHours,
      cycleLengthDays: dto.cycleLengthDays,
      restDaysPerWeek: dto.restDaysPerWeek,
    });

    const workers = await this.prisma.user.findMany({ where: { id: { in: dto.workerIds } } });
    const workerById = new Map(workers.map((w) => [w.id, w]));
    const anchorDate = new Date(`${dto.anchorDate}T00:00:00`);
    const horizon = addDays(anchorDate, (dto.horizonWeeks ?? 8) * 7);
    const lunchMinutes = dto.lunchMinutes ?? 0;

    const createdWorkers: Array<{
      userId: string;
      fullName: string;
      slotIndex: number;
      slot: { startTime: string; endTime: string };
      restDayOffsets: number[];
      patternId: string;
      shiftsGenerated: number;
    }> = [];

    for (const workerPlan of plan.workerPlans) {
      const worker = workerById.get(workerPlan.workerId);
      const slot = plan.slots[workerPlan.primarySlotIndex];

      const pattern = await this.prisma.shiftPattern.create({
        data: {
          companyId,
          name: `${dto.name} - Turno ${slot.startTime}-${slot.endTime} (${worker?.fullName ?? workerPlan.workerId})`,
          cycleLengthDays: plan.cycleLengthDays,
          days: {
            create: workerPlan.days.map((day) => {
              const daySlot = day.slotIndex !== undefined ? plan.slots[day.slotIndex] : undefined;
              return {
                dayOffset: day.dayOffset,
                isRestDay: day.isRestDay,
                rotationType: daySlot?.rotationType ?? slot.rotationType,
                startTime: day.isRestDay || !daySlot ? null : hhmmToTime(daySlot.startTime),
                endTime: day.isRestDay || !daySlot ? null : hhmmToTime(daySlot.endTime),
                lunchMinutes,
              };
            }),
          },
        },
      });

      await this.prisma.userShiftPatternAssignment.create({
        data: { userId: workerPlan.workerId, patternId: pattern.id, anchorDate, validFrom: anchorDate },
      });

      const shiftsGenerated = await this.generateShiftsForUser(workerPlan.workerId, anchorDate, horizon);

      createdWorkers.push({
        userId: workerPlan.workerId,
        fullName: worker?.fullName ?? workerPlan.workerId,
        slotIndex: workerPlan.primarySlotIndex,
        slot: { startTime: slot.startTime, endTime: slot.endTime },
        restDayOffsets: workerPlan.days.filter((d) => d.isRestDay).map((d) => d.dayOffset),
        patternId: pattern.id,
        shiftsGenerated,
      });
    }

    return {
      slots: plan.slots,
      cycleLengthDays: plan.cycleLengthDays,
      warnings: plan.warnings,
      workers: createdWorkers,
    };
  }

  /**
   * Genera la rutina de ordeño: jornada partida (ordeño manana + tarde) con
   * ciclo de descanso quincenal por trabajador y rotacion diaria del rol de
   * vaquero, exigiendo siempre 2 ordeñadores + 1 vaquero disponibles. Si el
   * equipo dado no alcanza para cubrir todos los dias del ciclo, no crea
   * nada y devuelve cuantos trabajadores hacen falta en total.
   */
  async smartGenerateMilking(companyId: string, dto: SmartGenerateMilkingDto) {
    const allWorkerIds = dto.comodinWorkerId ? [...dto.workerIds, dto.comodinWorkerId] : dto.workerIds;
    const plan = planMilkingRotation({
      workerIds: allWorkerIds,
      comodinWorkerId: dto.comodinWorkerId,
      stationsCount: dto.stationsCount,
      fullDayWorkerIds: dto.fullDayWorkerIds,
      reducedRestWorkerIds: dto.reducedRestWorkerIds,
      vaqueroWorkerIds: dto.vaqueroWorkerIds,
    });

    if (!plan.feasible) {
      const workersForNames = await this.prisma.user.findMany({ where: { id: { in: allWorkerIds } } });
      const nameById = new Map(workersForNames.map((w) => [w.id, w.fullName]));
      return {
        feasible: false,
        warnings: plan.warnings,
        minimumWorkersNeeded: plan.minimumWorkersNeeded,
        suggestedFullDayWorkerIds: plan.suggestedFullDayWorkerIds,
        suggestedFullDayWorkerNames: plan.suggestedFullDayWorkerIds?.map((id) => nameById.get(id) ?? id),
        suggestedReducedRestWorkerIds: plan.suggestedReducedRestWorkerIds,
        suggestedReducedRestWorkerNames: plan.suggestedReducedRestWorkerIds?.map((id) => nameById.get(id) ?? id),
      };
    }

    const morningStart = dto.morningStart ?? '04:00';
    const morningEnd = dto.morningEnd ?? '08:00';
    const eveningStart = dto.eveningStart ?? '16:00';
    const eveningEnd = dto.eveningEnd ?? '20:00';
    const lunchMinutes = (hhmmToTime(eveningStart).getTime() - hhmmToTime(morningEnd).getTime()) / 60_000;

    const workers = await this.prisma.user.findMany({ where: { id: { in: allWorkerIds } } });
    const workerById = new Map(workers.map((w) => [w.id, w]));
    const anchorDate = new Date(`${dto.anchorDate}T00:00:00`);
    const horizon = addDays(anchorDate, (dto.horizonWeeks ?? 8) * 7);

    // Horario compartido: solo necesitamos que resuelva correctamente el
    // hueco de medio dia (almuerzo largo) entre el ordeño de la manana y el
    // de la tarde; el turno concreto de cada dia lo pone el ShiftPattern.
    const schedule = await this.prisma.schedule.create({
      data: {
        companyId,
        name: `${dto.name} - Horario`,
        defaultLunchMinutes: Math.max(0, Math.round(lunchMinutes)),
        lunchWindowStart: hhmmToTime(morningEnd),
        lunchWindowEnd: hhmmToTime(eveningStart),
        lunchToleranceMinutes: 30,
      },
    });

    const offsetByWorker = new Map(plan.workerOffsets.map((w) => [w.workerId, w.offset]));

    const createdWorkers: Array<{
      userId: string;
      fullName: string;
      role: 'ORDENADOR_VAQUERO' | 'COMODIN';
      patternId: string;
      shiftsGenerated: number;
    }> = [];

    const fullDaySet = new Set(dto.fullDayWorkerIds ?? []);
    const reducedRestSet = new Set(dto.reducedRestWorkerIds ?? []);

    for (const workerId of allWorkerIds) {
      const worker = workerById.get(workerId);
      const isComodin = workerId === dto.comodinWorkerId;
      const hasShortDay = !fullDaySet.has(workerId);
      const hasWeekBSecondRest = !reducedRestSet.has(workerId);

      const pattern = await this.prisma.shiftPattern.create({
        data: {
          companyId,
          name: `${dto.name} - ${worker?.fullName ?? workerId}`,
          cycleLengthDays: MILKING_CYCLE_LENGTH_DAYS,
          days: {
            create: Array.from({ length: MILKING_CYCLE_LENGTH_DAYS }, (_, sharedDay) => {
              const kind = isComodin
                ? 'DISPONIBLE'
                : workerDayKindOnSharedDay(sharedDay, offsetByWorker.get(workerId)!, hasShortDay, hasWeekBSecondRest);
              if (kind === 'DESCANSO') {
                return { dayOffset: sharedDay, isRestDay: true, rotationType: 'DESCANSO' as const, startTime: null, endTime: null, lunchMinutes: 0 };
              }
              if (kind === 'CORTO') {
                return {
                  dayOffset: sharedDay,
                  isRestDay: false,
                  rotationType: 'DIURNO' as const,
                  startTime: morningStart,
                  endTime: morningEnd,
                  lunchMinutes: 0,
                };
              }
              return {
                dayOffset: sharedDay,
                isRestDay: false,
                rotationType: 'MIXTO' as const,
                startTime: morningStart,
                endTime: eveningEnd,
                lunchMinutes: Math.max(0, Math.round(lunchMinutes)),
              };
            }).map((day) => ({
              ...day,
              startTime: day.startTime ? hhmmToTime(day.startTime) : null,
              endTime: day.endTime ? hhmmToTime(day.endTime) : null,
            })),
          },
        },
      });

      await this.prisma.userShiftPatternAssignment.create({
        data: { userId: workerId, patternId: pattern.id, anchorDate, validFrom: anchorDate },
      });
      await this.prisma.userSchedule.create({
        data: { userId: workerId, scheduleId: schedule.id, validFrom: anchorDate },
      });

      const shiftsGenerated = await this.generateShiftsForUser(workerId, anchorDate, horizon);

      createdWorkers.push({
        userId: workerId,
        fullName: worker?.fullName ?? workerId,
        role: isComodin ? 'COMODIN' : 'ORDENADOR_VAQUERO',
        patternId: pattern.id,
        shiftsGenerated,
      });
    }

    // Segunda pasada: etiqueta cada turno generado con el rol especifico de
    // ese dia (ordeñador o vaquero, y de que ordeño/estacion), segun el
    // reparto que calculo el plan.
    for (let day = anchorDate; day < horizon; day = addDays(day, 1)) {
      const sharedDay = ((daysBetween(anchorDate, day) % MILKING_CYCLE_LENGTH_DAYS) + MILKING_CYCLE_LENGTH_DAYS) % MILKING_CYCLE_LENGTH_DAYS;
      const dayPlan = plan.days[sharedDay];
      for (const station of dayPlan.stations) {
        const stationLabel = plan.stationsCount > 1 ? ` (Ordeño ${station.stationIndex + 1})` : '';
        for (const workerId of station.ordenadores) {
          await this.prisma.shift.updateMany({ where: { userId: workerId, workDate: day }, data: { notes: `${ROLE_LABELS.ORDENADOR}${stationLabel}` } });
        }
        const vaqueroLabel = station.isVaqueroSubstitute ? `${ROLE_LABELS.VAQUERO}${stationLabel} (reemplazo)` : `${ROLE_LABELS.VAQUERO}${stationLabel}`;
        await this.prisma.shift.updateMany({ where: { userId: station.vaquero, workDate: day }, data: { notes: vaqueroLabel } });
      }
    }

    return {
      feasible: true,
      cycleLengthDays: plan.cycleLengthDays,
      stationsCount: plan.stationsCount,
      scheduleId: schedule.id,
      workers: createdWorkers,
      days: plan.days.map((d) => ({
        dayOffset: d.dayOffset,
        stations: d.stations.map((s) => ({
          stationIndex: s.stationIndex,
          ordenadores: s.ordenadores.map((id) => workerById.get(id)?.fullName ?? id),
          vaquero: workerById.get(s.vaquero)?.fullName ?? s.vaquero,
          isVaqueroSubstitute: s.isVaqueroSubstitute,
        })),
        workersOnShortDay: d.workersOnShortDay.map((id) => workerById.get(id)?.fullName ?? id),
        workersResting: d.workersResting.map((id) => workerById.get(id)?.fullName ?? id),
      })),
    };
  }

  /**
   * Rutina de ordeño POR ROLES: cada persona tiene su puesto base (ordeñador
   * fijo o de relevo de un ordeño, vaquero de una vaqueria, o comodin) y el
   * mismo ciclo de descanso de 14 dias. El sistema reparte los puestos de
   * cada dia y dice que dias quedan sin cubrir. Con `preview` solo calcula;
   * sin `preview` crea las plantillas, asigna a cada persona y genera los
   * turnos -- y solo si ningun puesto queda sin cubrir.
   */
  async milkingRoster(companyId: string, dto: MilkingRosterDto) {
    const userIds = dto.workers.map((w) => w.userId);
    if (new Set(userIds).size !== userIds.length) {
      throw new BadRequestException('Hay una persona repetida en la rutina.');
    }
    const users = await this.prisma.user.findMany({ where: { id: { in: userIds }, companyId }, select: { id: true, fullName: true } });
    if (users.length !== userIds.length) {
      throw new BadRequestException('Alguna de las personas seleccionadas no pertenece a esta empresa.');
    }
    for (const worker of dto.workers) {
      if (worker.role !== 'COMODIN' && (worker.homeStation ?? 0) >= dto.stationsCount) {
        throw new BadRequestException(`El ordeño base de una persona no existe (solo hay ${dto.stationsCount} ordeño(s)).`);
      }
    }
    const nameById = new Map(users.map((u) => [u.id, u.fullName]));

    const plan = planMilkingRoster({
      stationsCount: dto.stationsCount,
      workers: dto.workers.map((w) => ({ id: w.userId, role: w.role, homeStation: w.homeStation, shortDayOffset: w.shortDayOffset })),
    });

    const anchorDate = new Date(`${dto.anchorDate}T00:00:00`);
    const offsetByWorker = new Map(plan.workerOffsets.map((w) => [w.workerId, w]));
    const result = {
      feasible: plan.feasible,
      created: false,
      cycleLengthDays: plan.cycleLengthDays,
      stationsCount: plan.stationsCount,
      anchorDate: dto.anchorDate,
      workers: dto.workers.map((w) => ({
        userId: w.userId,
        fullName: nameById.get(w.userId) ?? w.userId,
        role: w.role,
        homeStation: w.role === 'COMODIN' ? null : w.homeStation ?? 0,
        shortDayOffset: offsetByWorker.get(w.userId)?.offset ?? 0,
        chosenBySystem: offsetByWorker.get(w.userId)?.chosenBySystem ?? false,
      })),
      days: plan.days.map((day) => ({
        dayOffset: day.dayOffset,
        date: toDateKey(addDays(anchorDate, day.dayOffset)),
        cells: day.cells.map((cell) => ({
          userId: cell.workerId,
          kind: cell.kind,
          post: cell.post ?? null,
          station: cell.station ?? null,
          isCover: cell.isCover,
        })),
      })),
      gaps: plan.gaps.map((gap) => ({ ...gap, date: toDateKey(addDays(anchorDate, gap.dayOffset)) })),
      vaqueriaCoversByOrdenadores: plan.vaqueriaCoversByOrdenadores,
      warnings: plan.warnings,
      scheduleId: null as string | null,
      shiftsGenerated: 0,
    };

    if (dto.preview || !plan.feasible) return result;

    const morningStart = dto.morningStart ?? '04:00';
    const morningEnd = dto.morningEnd ?? '08:00';
    const eveningStart = dto.eveningStart ?? '16:00';
    const eveningEnd = dto.eveningEnd ?? '20:00';
    const lunchMinutes = Math.max(0, Math.round((hhmmToTime(eveningStart).getTime() - hhmmToTime(morningEnd).getTime()) / 60_000));
    const horizon = addDays(anchorDate, (dto.horizonWeeks ?? 8) * 7);
    const dayBeforeAnchor = addDays(anchorDate, -1);

    // Mismo horario compartido que la rutina de ordeño clasica: resuelve el
    // hueco de medio dia entre el ordeño de la manana y el de la tarde.
    const schedule = await this.prisma.schedule.create({
      data: {
        companyId,
        name: `${dto.name} - Horario`,
        defaultLunchMinutes: lunchMinutes,
        lunchWindowStart: hhmmToTime(morningEnd),
        lunchWindowEnd: hhmmToTime(eveningStart),
        lunchToleranceMinutes: 30,
      },
    });
    result.scheduleId = schedule.id;

    for (const worker of dto.workers) {
      const cells = plan.days.map((day) => day.cells.find((cell) => cell.workerId === worker.userId)!);

      const pattern = await this.prisma.shiftPattern.create({
        data: {
          companyId,
          name: `${dto.name} - ${nameById.get(worker.userId) ?? worker.userId}`,
          cycleLengthDays: MILKING_CYCLE_LENGTH_DAYS,
          days: {
            create: cells.map((cell, dayOffset) => {
              if (cell.kind === 'DESCANSO') {
                return { dayOffset, isRestDay: true, rotationType: 'DESCANSO' as const, startTime: null, endTime: null, lunchMinutes: 0, notes: null };
              }
              if (cell.kind === 'CORTO') {
                return {
                  dayOffset,
                  isRestDay: false,
                  rotationType: 'DIURNO' as const,
                  startTime: hhmmToTime(morningStart),
                  endTime: hhmmToTime(morningEnd),
                  lunchMinutes: 0,
                  notes: milkingPostLabel(cell),
                };
              }
              return {
                dayOffset,
                isRestDay: false,
                rotationType: 'MIXTO' as const,
                startTime: hhmmToTime(morningStart),
                endTime: hhmmToTime(eveningEnd),
                lunchMinutes,
                notes: milkingPostLabel(cell),
              };
            }),
          },
        },
      });

      // La rutina nueva reemplaza, desde su fecha de inicio, la rutina y el
      // horario que la persona tuviera: se les pone fecha de fin (no se borran).
      const stillActive = { userId: worker.userId, OR: [{ validTo: null }, { validTo: { gte: anchorDate } }] };
      await this.prisma.userShiftPatternAssignment.updateMany({ where: stillActive, data: { validTo: dayBeforeAnchor } });
      await this.prisma.userSchedule.updateMany({ where: stillActive, data: { validTo: dayBeforeAnchor } });

      await this.prisma.userShiftPatternAssignment.create({
        data: { userId: worker.userId, patternId: pattern.id, anchorDate, validFrom: anchorDate },
      });
      await this.prisma.userSchedule.create({
        data: { userId: worker.userId, scheduleId: schedule.id, validFrom: anchorDate },
      });

      result.shiftsGenerated += await this.generateShiftsForUser(worker.userId, anchorDate, horizon);
    }

    result.created = true;
    return result;
  }

  /**
   * Rutinas de ordeño por roles que estan vigentes en `dateIso` (hoy si no
   * viene), reconstruidas desde las plantillas ya creadas, en el mismo
   * formato que devuelve `milkingRoster`: para volver a ver la planilla de
   * las semanas A y B en cualquier momento, no solo al crearla.
   */
  async currentMilkingRosters(companyId: string, dateIso?: string) {
    const date = dateIso ? new Date(`${dateIso.slice(0, 10)}T00:00:00`) : new Date(new Date().setHours(0, 0, 0, 0));
    const assignments = await this.prisma.userShiftPatternAssignment.findMany({
      where: {
        user: { companyId, isActive: true },
        validFrom: { lte: date },
        OR: [{ validTo: null }, { validTo: { gte: date } }],
        pattern: { cycleLengthDays: MILKING_CYCLE_LENGTH_DAYS, days: { some: { notes: { not: null } } } },
      },
      orderBy: { validFrom: 'desc' },
      include: { user: { select: { id: true, fullName: true } }, pattern: { include: { days: true } } },
    });

    // Una asignacion por persona (la mas reciente), agrupadas por rutina.
    const seenUsers = new Set<string>();
    const groups = new Map<string, { name: string; anchorDate: Date; members: typeof assignments }>();
    for (const assignment of assignments) {
      if (seenUsers.has(assignment.userId)) continue;
      seenUsers.add(assignment.userId);
      const suffix = ` - ${assignment.user.fullName}`;
      const name = assignment.pattern.name.endsWith(suffix) ? assignment.pattern.name.slice(0, -suffix.length) : assignment.pattern.name;
      const key = `${name}|${toDateKey(assignment.anchorDate)}`;
      if (!groups.has(key)) groups.set(key, { name, anchorDate: assignment.anchorDate, members: [] });
      groups.get(key)!.members.push(assignment);
    }

    return [...groups.values()].map((group) => {
      // `anchorDate` es columna DATE (medianoche UTC): se lee con getters UTC.
      const anchorKey = group.anchorDate.toISOString().slice(0, 10);
      const anchorLocal = new Date(`${anchorKey}T00:00:00`);

      const rows = group.members.map((member) => {
        const cells = Array.from({ length: MILKING_CYCLE_LENGTH_DAYS }, (_, dayOffset) => {
          const day = member.pattern.days.find((d) => d.dayOffset === dayOffset);
          const parsed = parseMilkingPostLabel(day?.notes ?? null);
          if (!day || day.isRestDay || !parsed) {
            return { userId: member.userId, kind: 'DESCANSO' as const, post: null, station: null, isCover: false };
          }
          return {
            userId: member.userId,
            kind: parsed.isShortDay ? ('CORTO' as const) : ('COMPLETO' as const),
            post: parsed.post,
            station: parsed.station,
            isCover: parsed.isCover,
          };
        });

        // El puesto base no se guarda: se deduce de donde trabaja la persona.
        const fullDays = cells.filter((c) => c.kind === 'COMPLETO');
        const countByPost = new Map<string, number>();
        for (const cell of fullDays) countByPost.set(`${cell.post}:${cell.station}`, (countByPost.get(`${cell.post}:${cell.station}`) ?? 0) + 1);
        const hasCover = fullDays.some((c) => c.isCover);
        const [mainPost] = [...countByPost.entries()].sort((a, b) => b[1] - a[1])[0] ?? ['ORDENO:0'];
        const [mainKind, mainStation] = mainPost.split(':');
        const isComodin = countByPost.size > 1 && !hasCover;
        const role = isComodin ? 'COMODIN' : mainKind === 'VAQUERIA' ? 'VAQUERO' : hasCover ? 'RELEVO' : 'ORDENADOR';
        const shortDayOffset = cells.findIndex((c) => c.kind === 'CORTO');

        return {
          worker: {
            userId: member.userId,
            fullName: member.user.fullName,
            role: role as 'ORDENADOR' | 'RELEVO' | 'VAQUERO' | 'COMODIN',
            homeStation: isComodin ? null : Number(mainStation),
            shortDayOffset: Math.max(0, shortDayOffset),
            chosenBySystem: false,
          },
          cells,
        };
      });

      const stationsCount = Math.max(1, ...rows.flatMap((row) => row.cells.map((cell) => (cell.station ?? 0) + 1)));
      const days = Array.from({ length: MILKING_CYCLE_LENGTH_DAYS }, (_, dayOffset) => ({
        dayOffset,
        date: toDateKey(addDays(anchorLocal, dayOffset)),
        cells: rows.map((row) => row.cells[dayOffset]),
      }));
      const gaps = days.flatMap((day) =>
        Array.from({ length: stationsCount }, (_, station) => {
          const ordenadores = day.cells.filter((c) => c.kind === 'COMPLETO' && c.post === 'ORDENO' && c.station === station).length;
          const vaqueros = day.cells.filter((c) => c.kind === 'COMPLETO' && c.post === 'VAQUERIA' && c.station === station).length;
          return [
            ...(ordenadores < 2 ? [{ dayOffset: day.dayOffset, date: day.date, station, post: 'ORDENO' as const, missing: 2 - ordenadores }] : []),
            ...(vaqueros < 1 ? [{ dayOffset: day.dayOffset, date: day.date, station, post: 'VAQUERIA' as const, missing: 1 }] : []),
          ];
        }).flat(),
      );

      return {
        name: group.name,
        feasible: gaps.length === 0,
        created: true,
        cycleLengthDays: MILKING_CYCLE_LENGTH_DAYS,
        stationsCount,
        anchorDate: anchorKey,
        workers: rows.map((row) => row.worker),
        days,
        gaps,
        vaqueriaCoversByOrdenadores: 0,
        warnings: [] as string[],
        scheduleId: null as string | null,
        shiftsGenerated: 0,
      };
    });
  }

  /** Asigna una plantilla a cada integrante activo de un departamento, con un ancla opcionalmente desfasada por persona. */
  async assignToTeam(patternId: string, dto: AssignPatternToTeamDto) {
    const members = await this.prisma.user.findMany({
      where: { departmentId: dto.departmentId, isActive: true },
      orderBy: { employeeCode: 'asc' },
    });

    const validFrom = dto.validFrom ? new Date(`${dto.validFrom}T00:00:00`) : new Date(`${dto.anchorDate}T00:00:00`);
    const baseAnchor = new Date(`${dto.anchorDate}T00:00:00`);
    const staggerDays = dto.staggerDays ?? 0;

    const assignments = await Promise.all(
      members.map((member, index) =>
        this.prisma.userShiftPatternAssignment.create({
          data: {
            userId: member.id,
            patternId,
            anchorDate: addDays(baseAnchor, index * staggerDays),
            validFrom,
          },
        }),
      ),
    );

    return { assignedCount: assignments.length, assignments };
  }

  assignToUser(patternId: string, dto: AssignPatternToUserDto) {
    return this.prisma.userShiftPatternAssignment.create({
      data: {
        userId: dto.userId,
        patternId,
        anchorDate: new Date(`${dto.anchorDate}T00:00:00`),
        validFrom: dto.validFrom ? new Date(`${dto.validFrom}T00:00:00`) : new Date(`${dto.anchorDate}T00:00:00`),
        validTo: dto.validTo ? new Date(`${dto.validTo}T00:00:00`) : null,
      },
    });
  }

  /** Genera (o actualiza) las filas de `shifts` para un usuario en un rango, siguiendo su plantilla activa. */
  async generateShiftsForUser(userId: string, from: Date, to: Date): Promise<number> {
    let generated = 0;
    for (let day = from; day <= to; day = addDays(day, 1)) {
      const created = await this.generateShiftForUserDay(userId, day);
      if (created) generated += 1;
    }
    return generated;
  }

  async generateShiftsForDepartment(departmentId: string, from: Date, to: Date): Promise<number> {
    const members = await this.prisma.user.findMany({ where: { departmentId, isActive: true } });
    let generated = 0;
    for (const member of members) {
      generated += await this.generateShiftsForUser(member.id, from, to);
    }
    return generated;
  }

  private async generateShiftForUserDay(userId: string, day: Date): Promise<boolean> {
    const assignment = await this.prisma.userShiftPatternAssignment.findFirst({
      where: {
        userId,
        validFrom: { lte: day },
        OR: [{ validTo: null }, { validTo: { gte: day } }],
      },
      orderBy: { validFrom: 'desc' },
      include: { pattern: { include: { days: true } } },
    });
    if (!assignment) return false;

    const cycleLength = assignment.pattern.cycleLengthDays;
    const offset = ((daysBetween(assignment.anchorDate, day) % cycleLength) + cycleLength) % cycleLength;
    const patternDay = assignment.pattern.days.find((d) => d.dayOffset === offset);
    if (!patternDay) return false;

    await this.prisma.shift.upsert({
      where: { userId_workDate: { userId, workDate: day } },
      create: {
        userId,
        workDate: day,
        rotationType: patternDay.rotationType,
        isRestDay: patternDay.isRestDay,
        plannedStart: patternDay.startTime ? combineDateAndTime(day, patternDay.startTime) : day,
        plannedEnd: patternDay.endTime ? combineDateAndTime(day, patternDay.endTime) : day,
        plannedLunchMinutes: patternDay.lunchMinutes,
        notes: patternDay.notes ?? `Generado por rutina "${assignment.pattern.name ?? ''}"`.trim(),
      },
      update: {
        rotationType: patternDay.rotationType,
        isRestDay: patternDay.isRestDay,
        plannedStart: patternDay.startTime ? combineDateAndTime(day, patternDay.startTime) : day,
        plannedEnd: patternDay.endTime ? combineDateAndTime(day, patternDay.endTime) : day,
        plannedLunchMinutes: patternDay.lunchMinutes,
        // El puesto del dia viene de la plantilla (rutina por roles); las
        // plantillas sin puesto por dia no pisan la nota que ya tenga el turno.
        ...(patternDay.notes ? { notes: patternDay.notes } : {}),
      },
    });
    return true;
  }

  /** Extiende semanalmente todas las asignaciones activas, para que siempre haya turnos generados unas semanas adelante. */
  @Cron(CronExpression.EVERY_WEEK)
  async extendActiveAssignments() {
    const today = new Date();
    const horizon = addDays(today, GENERATION_HORIZON_WEEKS * 7);
    const activeAssignments = await this.prisma.userShiftPatternAssignment.findMany({
      where: { OR: [{ validTo: null }, { validTo: { gte: today } }] },
      select: { userId: true },
      distinct: ['userId'],
    });

    for (const { userId } of activeAssignments) {
      await this.generateShiftsForUser(userId, today, horizon);
    }
    this.logger.log(`Turnos rotativos extendidos para ${activeAssignments.length} empleados hasta ${horizon.toISOString().slice(0, 10)}.`);
  }

  async findPatternOrThrow(patternId: string) {
    const pattern = await this.prisma.shiftPattern.findUnique({ where: { id: patternId } });
    if (!pattern) throw new NotFoundException(`Rutina de turno ${patternId} no encontrada`);
    return pattern;
  }
}
