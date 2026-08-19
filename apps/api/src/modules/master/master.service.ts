import { BadRequestException, Injectable } from '@nestjs/common';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import * as bcrypt from 'bcrypt';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { MasterResetDto } from './dto/master-reset.dto';
import { BootstrapCompanyDto } from './dto/bootstrap-company.dto';

export const RESET_CONFIRMATION_PHRASE = 'ELIMINAR TODO';

@Injectable()
export class MasterService {
  constructor(private readonly prisma: PrismaService) {}

  async getStatus() {
    const [companies, users, timeLogs] = await Promise.all([
      this.prisma.company.count(),
      this.prisma.user.count(),
      this.prisma.timeLog.count(),
    ]);
    return { companies, users, timeLogs };
  }

  /**
   * Borra TODA la base de datos de negocio (todas las empresas y lo que
   * cuelgue de ellas, via cascade) y las fotos de evidencia en disco. No
   * toca `holidays`: es el calendario de festivos colombianos, dato de
   * referencia global, no de una empresa.
   */
  async resetDatabase(dto: MasterResetDto) {
    if (dto.confirmationPhrase !== RESET_CONFIRMATION_PHRASE) {
      throw new BadRequestException(`Debes escribir exactamente "${RESET_CONFIRMATION_PHRASE}" para confirmar.`);
    }

    // AttendanceDailyTotal no tiene relacion/FK declarada hacia User (solo
    // guarda el userId como campo suelto), asi que el cascade de borrar
    // companies/users no lo alcanza - hay que vaciarlo aparte.
    await this.prisma.attendanceDailyTotal.deleteMany({});
    await this.prisma.company.deleteMany({});

    this.wipeUploadedPhotos();

    return { success: true, message: 'Base de datos reiniciada. Ya puedes crear tu empresa desde cero.' };
  }

  private wipeUploadedPhotos() {
    const uploadsRoot = join(process.cwd(), 'uploads');
    rmSync(uploadsRoot, { recursive: true, force: true });
    mkdirSync(uploadsRoot, { recursive: true });
  }

  /** Crea la primera empresa + su administrador, para arrancar de cero despues de un reset (o en una instalacion nueva). */
  async bootstrapCompany(dto: BootstrapCompanyDto) {
    const passwordHash = await bcrypt.hash(dto.adminPassword, 10);

    const company = await this.prisma.company.create({
      data: {
        legalName: dto.legalName,
        nit: dto.nit,
        tradeName: dto.tradeName,
      },
    });

    const admin = await this.prisma.user.create({
      data: {
        companyId: company.id,
        employeeCode: 'ADM001',
        nationalId: dto.adminNationalId,
        fullName: dto.adminFullName,
        email: dto.adminEmail,
        role: UserRole.ADMIN,
        hireDate: new Date(),
        passwordHash,
      },
    });

    return {
      company: { id: company.id, legalName: company.legalName },
      admin: { id: admin.id, email: admin.email, employeeCode: admin.employeeCode },
    };
  }
}
