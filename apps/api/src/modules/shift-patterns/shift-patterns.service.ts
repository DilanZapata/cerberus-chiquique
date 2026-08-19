import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { planShiftRotation, planMilkingRotation, workerDayKindOnSharedDay, MILKING_CYCLE_LENGTH_DAYS } from '@cerberus/cst-rules';
import { PrismaService } from '../../database/prisma.service';
import { addDays, combineDateAndTime, daysBetween, hhmmToTime } from '../../common/utils/time.util';
import { CreateShiftPatternDto } from './dto/create-shift-pattern.dto';
import { AssignPatternToTeamDto, AssignPatternToUserDto } from './dto/assign-pattern.dto';
import { SmartGenerateShiftPatternDto } from './dto/smart-generate.dto';
import { SmartGenerateMilkingDto } from './dto/smart-generate-milking.dto';

const ROLE_LABELS: Record<string, string> = {
  ORDENADOR: 'Ordeñador',
  VAQUERO: 'Vaquero',
};

const GENERATION_HORIZON_WEEKS = 4;

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
        notes: `Generado por rutina "${assignment.pattern.name ?? ''}"`.trim(),
      },
      update: {
        rotationType: patternDay.rotationType,
        isRestDay: patternDay.isRestDay,
        plannedStart: patternDay.startTime ? combineDateAndTime(day, patternDay.startTime) : day,
        plannedEnd: patternDay.endTime ? combineDateAndTime(day, patternDay.endTime) : day,
        plannedLunchMinutes: patternDay.lunchMinutes,
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
