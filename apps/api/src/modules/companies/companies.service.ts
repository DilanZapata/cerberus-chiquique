import { Injectable, NotFoundException } from '@nestjs/common';
import { ScheduleDetail } from '@prisma/client';
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
    const schedule = await this.prisma.schedule.create({
      data: {
        companyId,
        name: dto.name,
        weeklyHoursTarget: dto.weeklyHoursTarget,
        defaultLunchMinutes: dto.defaultLunchMinutes,
        lunchToleranceMinutes: dto.lunchToleranceMinutes,
      },
    });
    await this.prisma.scheduleDetail.createMany({ data: this.buildDetailRows(schedule.id, dto.days) });
    const created = await this.prisma.schedule.findUniqueOrThrow({ where: { id: schedule.id }, include: { details: true } });
    return this.serializeSchedule(created);
  }

  async updateSchedule(companyId: string, scheduleId: string, dto: UpdateScheduleDto) {
    const schedule = await this.prisma.schedule.findFirst({ where: { id: scheduleId, companyId } });
    if (!schedule) throw new NotFoundException(`Horario ${scheduleId} no encontrado`);

    await this.prisma.schedule.update({
      where: { id: scheduleId },
      data: {
        name: dto.name,
        weeklyHoursTarget: dto.weeklyHoursTarget,
        defaultLunchMinutes: dto.defaultLunchMinutes,
        lunchToleranceMinutes: dto.lunchToleranceMinutes,
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

  /** Los campos @db.Time de Prisma llegan como Date (epoch UTC); el frontend los quiere en "HH:mm". */
  private serializeSchedule<T extends { details: ScheduleDetail[] }>(schedule: T) {
    return {
      ...schedule,
      details: schedule.details.map((d) => ({
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

  createPosition(companyId: string, dto: CreatePositionDto) {
    return this.prisma.position.create({
      data: { companyId, name: dto.name, scheduleId: dto.scheduleId },
      include: { schedule: true },
    });
  }

  async updatePosition(companyId: string, positionId: string, dto: UpdatePositionDto) {
    const position = await this.prisma.position.findFirst({ where: { id: positionId, companyId } });
    if (!position) throw new NotFoundException(`Cargo ${positionId} no encontrado`);
    return this.prisma.position.update({
      where: { id: positionId },
      data: dto,
      include: { schedule: true },
    });
  }
}
