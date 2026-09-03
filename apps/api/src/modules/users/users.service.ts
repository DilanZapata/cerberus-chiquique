import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { Prisma, ScheduleType, WorkSite } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { addDays, daysBetween, startOfLocalDay } from '../../common/utils/time.util';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateUserScheduleDto } from './dto/update-user-schedule.dto';

/** Aplana las filas de UserWorkSite a una lista simple de WorkSite, para no exponer el modelo intermedio a los consumidores de la API. */
function serializeUser<T extends { workSites: { workSite: WorkSite }[] }>(user: T) {
  return { ...user, workSites: user.workSites.map((a) => a.workSite) };
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(companyId: string) {
    const users = await this.prisma.user.findMany({
      where: { companyId },
      include: {
        department: true,
        workSites: { include: { workSite: true } },
        position: true,
        userSchedules: { include: { schedule: true }, orderBy: { validFrom: 'desc' } },
      },
      orderBy: { employeeCode: 'asc' },
    });
    return users.map(serializeUser);
  }

  async getOrThrow(companyId: string, id: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, companyId },
      include: {
        department: true,
        workSites: { include: { workSite: true } },
        position: { include: { schedule: true } },
        userSchedules: { include: { schedule: true }, orderBy: { validFrom: 'desc' } },
      },
    });
    if (!user) throw new NotFoundException(`Empleado ${id} no encontrado`);
    return serializeUser(user);
  }

  async create(companyId: string, dto: CreateUserDto) {
    const passwordHash = dto.password ? await bcrypt.hash(dto.password, 10) : undefined;
    const pinHash = dto.pin ? await bcrypt.hash(dto.pin, 10) : undefined;

    let cycleAnchorDate: Date | null = null;
    let cycleStartWeek = dto.cycleStartWeek ?? null;
    if (dto.scheduleId) {
      const schedule = await this.prisma.schedule.findFirst({ where: { id: dto.scheduleId, companyId } });
      if (!schedule) throw new NotFoundException(`Horario ${dto.scheduleId} no encontrado`);
      if (schedule.scheduleType === ScheduleType.BIWEEKLY_ROTATING) {
        if (!dto.cycleAnchorDate || !dto.cycleStartWeek) {
          throw new BadRequestException(
            'El horario elegido es rotativo (Semana A/B): indica la fecha de inicio del ciclo y la semana inicial.',
          );
        }
        cycleAnchorDate = new Date(`${dto.cycleAnchorDate}T00:00:00`);
      } else {
        cycleStartWeek = null;
      }
    }

    const user = await this.prisma.user.create({
      data: {
        companyId,
        employeeCode: dto.employeeCode,
        nationalId: dto.nationalId,
        fullName: dto.fullName,
        email: dto.email,
        role: dto.role,
        departmentId: dto.departmentId,
        positionId: dto.positionId,
        hireDate: new Date(`${dto.hireDate}T00:00:00`),
        baseSalary: dto.baseSalary ?? 0,
        allowsLunchSkip: dto.allowsLunchSkip ?? false,
        passwordHash,
        pinHash,
        workSites: dto.workSiteIds?.length
          ? { create: dto.workSiteIds.map((workSiteId) => ({ workSiteId })) }
          : undefined,
      },
    });

    if (dto.scheduleId) {
      await this.prisma.userSchedule.create({
        data: {
          userId: user.id,
          scheduleId: dto.scheduleId,
          validFrom: new Date(`${dto.hireDate}T00:00:00`),
          cycleAnchorDate,
          cycleStartWeek,
        },
      });
    }

    return user;
  }

  /**
   * Reasigna el horario individual de un empleado, versionado (sin corromper
   * el historial para fechas anteriores): cierra la asignacion activa antes
   * de `effectiveFrom` (o la actualiza en el lugar si su `validFrom` es la
   * misma fecha efectiva, para no dejar filas duplicadas del mismo dia) y
   * crea una nueva vigente desde entonces. `scheduleId: null` quita el
   * horario individual, el empleado vuelve a usar el de su cargo si tiene.
   */
  async updateSchedule(companyId: string, userId: string, dto: UpdateUserScheduleDto) {
    await this.getOrThrow(companyId, userId);
    const effectiveFrom = dto.effectiveFrom ? new Date(`${dto.effectiveFrom}T00:00:00`) : startOfLocalDay(new Date());

    // La asignacion que cubre effectiveFrom (si existe): por construccion de
    // este where, su validFrom siempre es <= effectiveFrom.
    const active = await this.prisma.userSchedule.findFirst({
      where: {
        userId,
        validFrom: { lte: effectiveFrom },
        OR: [{ validTo: null }, { validTo: { gte: effectiveFrom } }],
      },
      orderBy: { validFrom: 'desc' },
    });
    const replacesActiveSameDay = !!active && daysBetween(active.validFrom, effectiveFrom) === 0;

    // Cualquier version YA agendada a futuro (validFrom > effectiveFrom, ej.
    // de una reasignacion previa con una fecha efectiva distinta) queda
    // enteramente reemplazada por la nueva asignacion, que rige desde
    // effectiveFrom en adelante sin fecha de fin -- se elimina para no dejar
    // filas huerfanas que compitan por la misma fecha en el futuro.
    const cleanupFutureVersions = this.prisma.userSchedule.deleteMany({ where: { userId, validFrom: { gt: effectiveFrom } } });

    if (dto.scheduleId === null) {
      const ops: Prisma.PrismaPromise<unknown>[] = [cleanupFutureVersions];
      if (active) {
        ops.push(
          replacesActiveSameDay
            ? this.prisma.userSchedule.delete({ where: { id: active.id } })
            : this.prisma.userSchedule.update({ where: { id: active.id }, data: { validTo: addDays(effectiveFrom, -1) } }),
        );
      }
      await this.prisma.$transaction(ops);
      return this.getOrThrow(companyId, userId);
    }

    const schedule = await this.prisma.schedule.findFirst({ where: { id: dto.scheduleId, companyId } });
    if (!schedule) throw new NotFoundException(`Horario ${dto.scheduleId} no encontrado`);

    let cycleAnchorDate: Date | null = null;
    let cycleStartWeek = dto.cycleStartWeek ?? null;
    if (schedule.scheduleType === ScheduleType.BIWEEKLY_ROTATING) {
      if (!dto.cycleAnchorDate || !dto.cycleStartWeek) {
        throw new BadRequestException(
          'El horario elegido es rotativo (Semana A/B): indica la fecha de inicio del ciclo y la semana inicial.',
        );
      }
      cycleAnchorDate = new Date(`${dto.cycleAnchorDate}T00:00:00`);
    } else {
      cycleStartWeek = null;
    }

    const ops: Prisma.PrismaPromise<unknown>[] = [cleanupFutureVersions];
    if (replacesActiveSameDay) {
      ops.push(
        this.prisma.userSchedule.update({
          where: { id: active!.id },
          data: { scheduleId: dto.scheduleId, cycleAnchorDate, cycleStartWeek },
        }),
      );
    } else {
      if (active) {
        ops.push(this.prisma.userSchedule.update({ where: { id: active.id }, data: { validTo: addDays(effectiveFrom, -1) } }));
      }
      ops.push(
        this.prisma.userSchedule.create({
          data: { userId, scheduleId: dto.scheduleId, validFrom: effectiveFrom, cycleAnchorDate, cycleStartWeek },
        }),
      );
    }
    await this.prisma.$transaction(ops);

    return this.getOrThrow(companyId, userId);
  }

  async update(companyId: string, id: string, dto: UpdateUserDto) {
    await this.getOrThrow(companyId, id);
    const passwordHash = dto.password ? await bcrypt.hash(dto.password, 10) : undefined;
    const pinHash = dto.pin ? await bcrypt.hash(dto.pin, 10) : undefined;

    // Reemplazo completo de las sedes asignadas (mismo patron "borrar todo y
    // recrear" que ya usa upsertManualDay para marcas): mas simple y menos
    // propenso a errores que hacer un diff fila por fila, y esta relacion no
    // tiene historial que preservar.
    if (dto.workSiteIds) {
      await this.prisma.userWorkSite.deleteMany({ where: { userId: id } });
      if (dto.workSiteIds.length) {
        await this.prisma.userWorkSite.createMany({ data: dto.workSiteIds.map((workSiteId) => ({ userId: id, workSiteId })) });
      }
    }

    return this.prisma.user.update({
      where: { id },
      data: {
        fullName: dto.fullName,
        email: dto.email,
        role: dto.role,
        departmentId: dto.departmentId,
        positionId: dto.positionId,
        baseSalary: dto.baseSalary,
        allowsLunchSkip: dto.allowsLunchSkip,
        isActive: dto.isActive,
        ...(passwordHash ? { passwordHash } : {}),
        ...(pinHash ? { pinHash } : {}),
      },
    });
  }

  async deactivate(companyId: string, id: string) {
    await this.getOrThrow(companyId, id);
    return this.prisma.user.update({ where: { id }, data: { isActive: false } });
  }
}
