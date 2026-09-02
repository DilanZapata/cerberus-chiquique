import { Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { WorkSite } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

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
      include: { department: true, workSites: { include: { workSite: true } }, position: true },
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
        userSchedules: { include: { schedule: true } },
      },
    });
    if (!user) throw new NotFoundException(`Empleado ${id} no encontrado`);
    return serializeUser(user);
  }

  async create(companyId: string, dto: CreateUserDto) {
    const passwordHash = dto.password ? await bcrypt.hash(dto.password, 10) : undefined;
    const pinHash = dto.pin ? await bcrypt.hash(dto.pin, 10) : undefined;

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
        data: { userId: user.id, scheduleId: dto.scheduleId, validFrom: new Date(`${dto.hireDate}T00:00:00`) },
      });
    }

    return user;
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
