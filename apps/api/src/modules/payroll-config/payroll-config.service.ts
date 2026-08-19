import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PayrollConfigParams } from '@cerberus/shared-types';
import { PrismaService } from '../../database/prisma.service';
import { timeToHHmm, hhmmToTime } from '../../common/utils/time.util';
import { CreatePayrollConfigVersionDto } from './dto/create-payroll-config-version.dto';
import { UpdatePayrollConfigVersionDto } from './dto/update-payroll-config-version.dto';
import { UpdatePayrollSettingsDto } from './dto/update-payroll-settings.dto';

@Injectable()
export class PayrollConfigService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resuelve los parametros legales vigentes en `date` para una empresa,
   * combinando la version de `payroll_config_versions` de mayor
   * `effectiveFrom <= date` con los ajustes operativos de `payroll_settings`.
   */
  async resolveEffective(companyId: string, date: Date): Promise<PayrollConfigParams> {
    const [version, settings] = await Promise.all([
      this.prisma.payrollConfigVersion.findFirst({
        where: { companyId, effectiveFrom: { lte: date } },
        orderBy: { effectiveFrom: 'desc' },
      }),
      this.getOrCreateSettings(companyId),
    ]);

    if (!version) {
      throw new NotFoundException(
        `No hay una version de parametros de nomina vigente para la empresa ${companyId} en ${date.toISOString().slice(0, 10)}`,
      );
    }

    return {
      dayStartTime: timeToHHmm(version.dayStartTime),
      nightStartTime: timeToHHmm(version.nightStartTime),
      maxWeeklyHours: version.maxWeeklyHours.toNumber(),
      maxDailyOrdinaryHours: version.maxDailyOrdinaryHours.toNumber(),
      maxDailyOvertimeHours: version.maxDailyOvertimeHours.toNumber(),
      maxWeeklyOvertimeHours: version.maxWeeklyOvertimeHours.toNumber(),
      dominicalOcasionalMaxPerMonth: version.dominicalOcasionalMaxPerMonth,
      pctRecargoNocturno: version.pctRecargoNocturno.toNumber(),
      pctDominicalFestivo: version.pctDominicalFestivo.toNumber(),
      pctDominicalFestivoNocturno: version.pctDominicalFestivoNocturno.toNumber(),
      pctHoraExtraDiurna: version.pctHoraExtraDiurna.toNumber(),
      pctHoraExtraNocturna: version.pctHoraExtraNocturna.toNumber(),
      pctHoraExtraFestivaDiurna: version.pctHoraExtraFestivaDiurna.toNumber(),
      pctHoraExtraFestivaNocturna: version.pctHoraExtraFestivaNocturna.toNumber(),
      overtimeRequiresPreauthorization: settings.overtimeRequiresPreauthorization,
      overtimePendingAlertDays: settings.overtimePendingAlertDays,
    };
  }

  listVersions(companyId: string) {
    return this.prisma.payrollConfigVersion.findMany({
      where: { companyId },
      orderBy: { effectiveFrom: 'desc' },
    });
  }

  createVersion(companyId: string, dto: CreatePayrollConfigVersionDto) {
    return this.prisma.payrollConfigVersion.create({
      data: {
        companyId,
        effectiveFrom: new Date(`${dto.effectiveFrom}T00:00:00Z`),
        dayStartTime: hhmmToTime(dto.dayStartTime),
        nightStartTime: hhmmToTime(dto.nightStartTime),
        maxWeeklyHours: dto.maxWeeklyHours,
        maxDailyOrdinaryHours: dto.maxDailyOrdinaryHours,
        maxDailyOvertimeHours: dto.maxDailyOvertimeHours,
        maxWeeklyOvertimeHours: dto.maxWeeklyOvertimeHours,
        dominicalOcasionalMaxPerMonth: dto.dominicalOcasionalMaxPerMonth,
        pctRecargoNocturno: dto.pctRecargoNocturno,
        pctDominicalFestivo: dto.pctDominicalFestivo,
        pctDominicalFestivoNocturno: dto.pctDominicalFestivoNocturno,
        pctHoraExtraDiurna: dto.pctHoraExtraDiurna,
        pctHoraExtraNocturna: dto.pctHoraExtraNocturna,
        pctHoraExtraFestivaDiurna: dto.pctHoraExtraFestivaDiurna,
        pctHoraExtraFestivaNocturna: dto.pctHoraExtraFestivaNocturna,
        notes: dto.notes,
      },
    });
  }

  async updateVersion(companyId: string, versionId: string, dto: UpdatePayrollConfigVersionDto) {
    const version = await this.prisma.payrollConfigVersion.findFirst({ where: { id: versionId, companyId } });
    if (!version) throw new NotFoundException(`Version ${versionId} no encontrada`);

    try {
      return await this.prisma.payrollConfigVersion.update({
        where: { id: versionId },
        data: {
          effectiveFrom: dto.effectiveFrom ? new Date(`${dto.effectiveFrom}T00:00:00Z`) : undefined,
          dayStartTime: dto.dayStartTime ? hhmmToTime(dto.dayStartTime) : undefined,
          nightStartTime: dto.nightStartTime ? hhmmToTime(dto.nightStartTime) : undefined,
          maxWeeklyHours: dto.maxWeeklyHours,
          maxDailyOrdinaryHours: dto.maxDailyOrdinaryHours,
          maxDailyOvertimeHours: dto.maxDailyOvertimeHours,
          maxWeeklyOvertimeHours: dto.maxWeeklyOvertimeHours,
          dominicalOcasionalMaxPerMonth: dto.dominicalOcasionalMaxPerMonth,
          pctRecargoNocturno: dto.pctRecargoNocturno,
          pctDominicalFestivo: dto.pctDominicalFestivo,
          pctDominicalFestivoNocturno: dto.pctDominicalFestivoNocturno,
          pctHoraExtraDiurna: dto.pctHoraExtraDiurna,
          pctHoraExtraNocturna: dto.pctHoraExtraNocturna,
          pctHoraExtraFestivaDiurna: dto.pctHoraExtraFestivaDiurna,
          pctHoraExtraFestivaNocturna: dto.pctHoraExtraFestivaNocturna,
          notes: dto.notes,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new BadRequestException('Ya existe otra version vigente desde esa misma fecha.');
      }
      throw err;
    }
  }

  async getOrCreateSettings(companyId: string) {
    const existing = await this.prisma.payrollSettings.findUnique({ where: { companyId } });
    if (existing) return existing;
    return this.prisma.payrollSettings.create({ data: { companyId } });
  }

  async updateSettings(companyId: string, dto: UpdatePayrollSettingsDto) {
    await this.getOrCreateSettings(companyId);
    return this.prisma.payrollSettings.update({ where: { companyId }, data: dto });
  }
}
