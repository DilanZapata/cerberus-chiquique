import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CycleWeek, DayOfWeek, ScheduleDetail, ScheduleType } from '@prisma/client';
import { addDays } from '../../common/utils/time.util';
import { resolveActiveCycleWeek } from '../../common/utils/rotating-schedule.util';
import { PrismaService } from '../../database/prisma.service';
import { hhmmToTime, timeToHHmm } from '../../common/utils/time.util';
import { UpdateCompanyDto } from './dto/update-company.dto';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { CreateWorkSiteDto } from './dto/create-work-site.dto';
import { UpdateWorkSiteDto } from './dto/update-work-site.dto';
import { CreateScheduleDto } from './dto/create-schedule.dto';
import { UpdateScheduleDto } from './dto/update-schedule.dto';
import { ScheduleDayDto } from './dto/schedule-day.dto';
import { CreatePositionDto } from './dto/create-position.dto';
import { UpdatePositionDto } from './dto/update-position.dto';

@Injectable()
export class CompaniesService {
  constructor(private readonly prisma: PrismaService) {}

  async getById(companyId: string) {
    const company = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (!company) throw new NotFoundException(`Empresa ${companyId} no encontrada`);
    return company;
  }

  update(companyId: string, dto: UpdateCompanyDto) {
    return this.prisma.company.update({ where: { id: companyId }, data: dto });
  }

  listDepartments(companyId: string) {
    return this.prisma.department.findMany({ where: { companyId }, orderBy: { name: 'asc' } });
  }

  createDepartment(companyId: string, dto: CreateDepartmentDto) {
    return this.prisma.department.create({ data: { companyId, name: dto.name } });
  }

  listWorkSites(companyId: string) {
    return this.prisma.workSite.findMany({ where: { companyId }, orderBy: { name: 'asc' } });
  }

  createWorkSite(companyId: string, dto: CreateWorkSiteDto) {
    return this.prisma.workSite.create({
      data: {
        companyId,
        name: dto.name,
        address: dto.address,
        latitude: dto.latitude,
        longitude: dto.longitude,
        gpsRadiusMeters: dto.gpsRadiusMeters ?? 150,
      },
    });
  }

  async updateWorkSite(companyId: string, workSiteId: string, dto: UpdateWorkSiteDto) {
    const site = await this.prisma.workSite.findFirst({ where: { id: workSiteId, companyId } });
    if (!site) throw new NotFoundException(`Sede ${workSiteId} no encontrada`);
    return this.prisma.workSite.update({ where: { id: workSiteId }, data: dto });
  }

  async listSchedules(companyId: string) {
    const schedules = await this.prisma.schedule.findMany({
      where: { companyId },
      include: { details: true },
      orderBy: { name: 'asc' },
    });
    return schedules.map((s) => this.serializeSchedule(s));
  }

  async createSchedule(companyId: string, dto: CreateScheduleDto) {
    const scheduleType = dto.scheduleType ?? ScheduleType.WEEKLY;
    this.validateDays(scheduleType, dto.days);

    const schedule = await this.prisma.schedule.create({
      data: {
        companyId,
        name: dto.name,
        scheduleType,
        weeklyHoursTarget: dto.weeklyHoursTarget,
        defaultLunchMinutes: dto.defaultLunchMinutes,
        lunchWindowStart: dto.lunchWindowStart ? hhmmToTime(dto.lunchWindowStart) : undefined,
        lunchWindowEnd: dto.lunchWindowEnd ? hhmmToTime(dto.lunchWindowEnd) : undefined,
        lunchToleranceMinutes: dto.lunchToleranceMinutes,
        finalExitWindowBeforeMin: dto.finalExitWindowBeforeMin,
        finalExitGraceMin: dto.finalExitGraceMin,
      },
    });
    await this.prisma.scheduleDetail.createMany({ data: this.buildDetailRows(schedule.id, dto.days) });
    const created = await this.prisma.schedule.findUniqueOrThrow({ where: { id: schedule.id }, include: { details: true } });
    return this.serializeSchedule(created);
  }

  async updateSchedule(companyId: string, scheduleId: string, dto: UpdateScheduleDto) {
    const schedule = await this.prisma.schedule.findFirst({
      where: { id: scheduleId, companyId },
      include: { positions: { select: { id: true } } },
    });
    if (!schedule) throw new NotFoundException(`Horario ${scheduleId} no encontrado`);

    const nextScheduleType = dto.scheduleType ?? schedule.scheduleType;
    const changingToRotating = nextScheduleType === ScheduleType.BIWEEKLY_ROTATING && schedule.scheduleType !== ScheduleType.BIWEEKLY_ROTATING;
    if (nextScheduleType === ScheduleType.BIWEEKLY_ROTATING && schedule.positions.length > 0) {
      throw new BadRequestException(
        'Este horario esta asignado a uno o mas cargos: un horario rotativo (Semana A/B) no puede asignarse a un cargo (el ciclo se ancla individualmente por empleado). Quita la asignacion del cargo antes de convertirlo en rotativo.',
      );
    }
    if (changingToRotating) {
      // Convertir un horario ya asignado individualmente (via UserSchedule)
      // dejaria a esos empleados sin ancla (cycleAnchorDate/cycleStartWeek
      // null en su fila existente), congelados silenciosamente en Semana A
      // sin ningun aviso -- exigir que se desasigne primero, igual que con
      // los cargos, en vez de intentar adivinar/backfillear un ancla.
      const assignedCount = await this.prisma.userSchedule.count({ where: { scheduleId } });
      if (assignedCount > 0) {
        throw new BadRequestException(
          `Este horario esta asignado individualmente a ${assignedCount} empleado(s): un horario rotativo necesita que cada empleado defina su propia fecha de inicio y semana inicial. Quita esas asignaciones antes de convertirlo en rotativo, y vuelve a asignarlo con el ancla correspondiente.`,
        );
      }
      // El tipo esta cambiando de WEEKLY (7 dias) a BIWEEKLY_ROTATING (14):
      // sin dias nuevos, quedarian 7 filas de Semana A y CERO de Semana B.
      if (!dto.days) {
        throw new BadRequestException('Para convertir este horario en rotativo, envia los 14 dias (Semana A y Semana B).');
      }
    }
    if (dto.days) this.validateDays(nextScheduleType, dto.days);

    await this.prisma.schedule.update({
      where: { id: scheduleId },
      data: {
        name: dto.name,
        scheduleType: dto.scheduleType,
        weeklyHoursTarget: dto.weeklyHoursTarget,
        defaultLunchMinutes: dto.defaultLunchMinutes,
        lunchWindowStart: dto.lunchWindowStart ? hhmmToTime(dto.lunchWindowStart) : undefined,
        lunchWindowEnd: dto.lunchWindowEnd ? hhmmToTime(dto.lunchWindowEnd) : undefined,
        lunchToleranceMinutes: dto.lunchToleranceMinutes,
        finalExitWindowBeforeMin: dto.finalExitWindowBeforeMin,
        finalExitGraceMin: dto.finalExitGraceMin,
      },
    });

    if (dto.days) {
      // Reemplazo completo: es mas simple y menos propenso a errores que
      // hacer un diff dia por dia, y el horario no tiene historial que
      // preservar (a diferencia de UserSchedule).
      await this.prisma.scheduleDetail.deleteMany({ where: { scheduleId } });
      await this.prisma.scheduleDetail.createMany({ data: this.buildDetailRows(scheduleId, dto.days) });
    }

    const updated = await this.prisma.schedule.findUniqueOrThrow({ where: { id: scheduleId }, include: { details: true } });
    return this.serializeSchedule(updated);
  }

  /**
   * Vista previa pura del ciclo A/B: para cada una de las proximas `weeks`
   * semanas a partir de `anchorDate`, indica cual semana (A/B) le
   * corresponde. No toca la base de datos -- reutiliza directamente
   * `resolveActiveCycleWeek`, la misma funcion que usa la resolucion real de
   * horario, para que la vista previa nunca pueda desincronizarse del
   * calculo real.
   */
  previewCycleWeeks(anchorDate: Date, startWeek: CycleWeek, weeks: number) {
    return Array.from({ length: weeks }, (_, i) => {
      const weekStart = addDays(anchorDate, i * 7);
      const weekEnd = addDays(weekStart, 6);
      return {
        weekStart: weekStart.toISOString().slice(0, 10),
        weekEnd: weekEnd.toISOString().slice(0, 10),
        week: resolveActiveCycleWeek(anchorDate, startWeek, weekStart),
      };
    });
  }

  /**
   * Un horario WEEKLY necesita exactamente 7 dias (uno por DayOfWeek, semana
   * A implicita). Un horario BIWEEKLY_ROTATING necesita exactamente 14: 7
   * para la Semana A y 7 para la Semana B, cada juego cubriendo los 7 dias
   * sin duplicados. Se valida aqui (no solo con decoradores) porque depende
   * de la combinacion scheduleType+days, no de un campo aislado.
   */
  private validateDays(scheduleType: ScheduleType, days: ScheduleDayDto[]): void {
    const ALL_DAYS = Object.values(DayOfWeek);
    const weeksNeeded: CycleWeek[] = scheduleType === ScheduleType.BIWEEKLY_ROTATING ? [CycleWeek.A, CycleWeek.B] : [CycleWeek.A];

    if (scheduleType !== ScheduleType.BIWEEKLY_ROTATING) {
      const wrongWeek = days.find((d) => d.week && d.week !== CycleWeek.A);
      if (wrongWeek) {
        throw new BadRequestException('Un horario normal (una sola semana) no puede tener dias marcados como Semana B.');
      }
    }

    for (const week of weeksNeeded) {
      const daysForWeek = days.filter((d) => (d.week ?? CycleWeek.A) === week);
      const coveredDays = new Set(daysForWeek.map((d) => d.dayOfWeek));
      const missing = ALL_DAYS.filter((d) => !coveredDays.has(d));
      if (daysForWeek.length !== 7 || missing.length > 0) {
        const weekLabel = scheduleType === ScheduleType.BIWEEKLY_ROTATING ? `la Semana ${week}` : 'el horario';
        throw new BadRequestException(
          `Faltan dias por configurar en ${weekLabel}${missing.length ? `: ${missing.join(', ')}` : ' (hay dias duplicados)'}.`,
        );
      }
    }
  }

  /** Los campos @db.Time de Prisma llegan como Date (epoch UTC); el frontend los quiere en "HH:mm". */
  private serializeSchedule<T extends { details: ScheduleDetail[]; lunchWindowStart: Date; lunchWindowEnd: Date }>(schedule: T) {
    return {
      ...schedule,
      lunchWindowStart: timeToHHmm(schedule.lunchWindowStart),
      lunchWindowEnd: timeToHHmm(schedule.lunchWindowEnd),
      details: schedule.details.map((d) => ({
        week: d.week,
        dayOfWeek: d.dayOfWeek,
        isWorkingDay: d.isWorkingDay,
        startTime: d.startTime ? timeToHHmm(d.startTime) : null,
        endTime: d.endTime ? timeToHHmm(d.endTime) : null,
        lunchMinutes: d.lunchMinutes,
      })),
    };
  }

  private buildDetailRows(scheduleId: string, days: ScheduleDayDto[]) {
    return days.map((day) => ({
      scheduleId,
      week: day.week ?? CycleWeek.A,
      dayOfWeek: day.dayOfWeek,
      isWorkingDay: day.isWorkingDay,
      startTime: day.isWorkingDay && day.startTime ? hhmmToTime(day.startTime) : null,
      endTime: day.isWorkingDay && day.endTime ? hhmmToTime(day.endTime) : null,
      lunchMinutes: day.lunchMinutes,
    }));
  }

  listPositions(companyId: string) {
    return this.prisma.position.findMany({
      where: { companyId },
      include: { schedule: true },
      orderBy: { name: 'asc' },
    });
  }

  async createPosition(companyId: string, dto: CreatePositionDto) {
    await this.assertScheduleAllowedForPosition(companyId, dto.scheduleId);
    return this.prisma.position.create({
      data: { companyId, name: dto.name, scheduleId: dto.scheduleId },
      include: { schedule: true },
    });
  }

  async updatePosition(companyId: string, positionId: string, dto: UpdatePositionDto) {
    const position = await this.prisma.position.findFirst({ where: { id: positionId, companyId } });
    if (!position) throw new NotFoundException(`Cargo ${positionId} no encontrado`);
    await this.assertScheduleAllowedForPosition(companyId, dto.scheduleId);
    return this.prisma.position.update({
      where: { id: positionId },
      data: dto,
      include: { schedule: true },
    });
  }

  /**
   * Ademas de bloquear los horarios rotativos (ver mas abajo), confirma que
   * el Schedule pertenece a la MISMA compañia -- sin este filtro, un UUID de
   * otra empresa pasaba silenciosamente (ningun otro punto de esta cadena
   * valida el tenant de scheduleId al crear/editar un cargo).
   *
   * Un horario rotativo (Semana A/B) nunca puede asignarse a un cargo: el
   * ancla del ciclo (fecha de inicio + semana inicial) es individual por
   * empleado y Position es compartido por todos los empleados de ese cargo
   * sin ningun ancla propia. Debe asignarse directamente al empleado (ver
   * UsersService.updateSchedule).
   */
  private async assertScheduleAllowedForPosition(companyId: string, scheduleId: string | undefined): Promise<void> {
    if (!scheduleId) return;
    const schedule = await this.prisma.schedule.findFirst({ where: { id: scheduleId, companyId }, select: { scheduleType: true } });
    if (!schedule) throw new NotFoundException(`Horario ${scheduleId} no encontrado`);
    if (schedule.scheduleType === ScheduleType.BIWEEKLY_ROTATING) {
      throw new BadRequestException(
        'Un horario rotativo (Semana A/B) no se puede asignar a un cargo: el ciclo se ancla individualmente por empleado. Asignalo directamente al empleado desde Empleados.',
      );
    }
  }
}
