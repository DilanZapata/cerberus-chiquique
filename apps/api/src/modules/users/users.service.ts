import { Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../database/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  list(companyId: string) {
    return this.prisma.user.findMany({
      where: { companyId },
      include: { department: true, workSite: true, position: true },
      orderBy: { employeeCode: 'asc' },
    });
  }

  async getOrThrow(companyId: string, id: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, companyId },
      include: {
        department: true,
        workSite: true,
        position: { include: { schedule: true } },
        userSchedules: { include: { schedule: true } },
      },
    });
    if (!user) throw new NotFoundException(`Empleado ${id} no encontrado`);
    return user;
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
        workSiteId: dto.workSiteId,
        positionId: dto.positionId,
        hireDate: new Date(`${dto.hireDate}T00:00:00`),
        baseSalary: dto.baseSalary ?? 0,
        allowsLunchSkip: dto.allowsLunchSkip ?? false,
        passwordHash,
        pinHash,
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

    return this.prisma.user.update({
      where: { id },
      data: {
        fullName: dto.fullName,
        email: dto.email,
        role: dto.role,
        departmentId: dto.departmentId,
        workSiteId: dto.workSiteId,
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
