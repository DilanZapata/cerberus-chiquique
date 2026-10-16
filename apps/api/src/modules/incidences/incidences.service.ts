import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { NoveltyStatus as PrismaNoveltyStatus, NoveltyCode as PrismaNoveltyCode } from '@prisma/client';
import { NoveltyStatus } from '@cerberus/shared-types';
import { PrismaService } from '../../database/prisma.service';
import { addDays } from '../../common/utils/time.util';
import { NoveltiesService } from '../novelties/novelties.service';
import { CreateIncidenceDto } from './dto/create-incidence.dto';
import { ReviewIncidenceDto } from './dto/review-incidence.dto';

function toPrismaStatus(status: NoveltyStatus): PrismaNoveltyStatus {
  return status as unknown as PrismaNoveltyStatus;
}

/**
 * Permisos e incapacidades: mismo patron de solicitud -> pendiente ->
 * aprobar/rechazar que `overtime-approval.service.ts`. Al aprobar, se dispara
 * el recalculo de novedades de cada dia del rango para que NoveltiesService
 * (que ya consulta esta tabla) reemplace el analisis de marcas por la
 * novedad de la incidencia.
 */
@Injectable()
export class IncidencesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly noveltiesService: NoveltiesService,
  ) {}

  /** `companyId` SIEMPRE del JWT de quien crea la incidencia: antes de esta
   * correccion cualquier usuario autenticado podia crear una incidencia
   * (permiso, incapacidad) para el `userId` de CUALQUIER empresa, inyectando
   * datos que luego alimentarian el calculo de nomina de una empresa ajena
   * (auditoria 2026-10-16, seccion C.1.d). */
  async create(companyId: string, dto: CreateIncidenceDto) {
    const target = await this.prisma.user.findUnique({ where: { id: dto.userId }, select: { companyId: true } });
    if (!target || target.companyId !== companyId) {
      throw new ForbiddenException('El empleado indicado no pertenece a tu empresa.');
    }
    return this.prisma.incidence.create({
      data: {
        userId: dto.userId,
        code: dto.code as unknown as PrismaNoveltyCode,
        startDate: new Date(`${dto.startDate}T00:00:00`),
        endDate: new Date(`${dto.endDate}T00:00:00`),
        hoursPerDay: dto.hoursPerDay,
        supportingDocUrl: dto.supportingDocUrl,
        notes: dto.notes,
        status: PrismaNoveltyStatus.PENDIENTE,
      },
    });
  }

  /** `companyId` SIEMPRE del JWT de quien consulta (mismo hallazgo que `create`). */
  listPending(companyId: string, departmentId?: string) {
    return this.prisma.incidence.findMany({
      where: {
        status: PrismaNoveltyStatus.PENDIENTE,
        user: { companyId, ...(departmentId ? { departmentId } : {}) },
      },
      include: {
        user: { select: { id: true, fullName: true, employeeCode: true, departmentId: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** `companyId` SIEMPRE del JWT de quien revisa (mismo hallazgo que `create`);
   * se responde igual que "no encontrada" para no revelar que la incidencia
   * existe en otra empresa. */
  async review(incidenceId: string, dto: ReviewIncidenceDto, reviewedById: string, companyId: string) {
    const incidence = await this.prisma.incidence.findFirst({ where: { id: incidenceId, user: { companyId } } });
    if (!incidence) {
      throw new NotFoundException(`Incidencia ${incidenceId} no encontrada`);
    }

    const updated = await this.prisma.incidence.update({
      where: { id: incidenceId },
      data: {
        status: toPrismaStatus(dto.status),
        approvedById: reviewedById,
        notes: dto.notes ?? incidence.notes,
      },
    });

    if (dto.status === NoveltyStatus.APROBADA) {
      for (let day = incidence.startDate; day <= incidence.endDate; day = addDays(day, 1)) {
        const workDate = day.toISOString().slice(0, 10);
        await this.noveltiesService.calculateAndPersistForDay(incidence.userId, workDate);
      }
    }

    return updated;
  }
}
