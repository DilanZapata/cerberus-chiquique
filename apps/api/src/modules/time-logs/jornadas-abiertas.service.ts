import { Injectable, NotFoundException } from '@nestjs/common';
import { NoveltyCode, NoveltyStatus as PrismaNoveltyStatus } from '@prisma/client';
import { NoveltyStatus } from '@cerberus/shared-types';
import { PrismaService } from '../../database/prisma.service';
import { findShiftMarks } from '../../common/utils/shift-marks.util';
import { startOfLocalDay } from '../../common/utils/time.util';
import { NoveltiesService } from '../novelties/novelties.service';
import { DEFAULT_FINAL_EXIT_GRACE_MIN } from './jornada-cierre.service';
import { ReviewJornadaDto } from './dto/review-jornada.dto';

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatHHmm(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function toPrismaStatus(status: NoveltyStatus): PrismaNoveltyStatus {
  return status as unknown as PrismaNoveltyStatus;
}

export type JornadaAbiertaEstado = 'SIN_HORARIO' | 'PENDIENTE_CIERRE' | 'VENCIDA_CIERRE_AUTOMATICO' | 'CERRADA_PENDIENTE_REVISION';

/**
 * Panel de "jornadas que requieren atencion" (Fase 3 del rediseno de control
 * de asistencia): combina, para un dia, las jornadas todavia abiertas mas
 * alla de su horario (candidatas al proximo ciclo del cron de
 * jornada-cierre.service.ts) con las que ese cron ya cerro y dejo
 * pendientes de revision (novedad SALIDA_NO_REGISTRADA). No incluye
 * jornadas normales en curso (alguien que sigue trabajando dentro de su
 * horario no es un caso que requiera atencion).
 */
@Injectable()
export class JornadasAbiertasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly noveltiesService: NoveltiesService,
  ) {}

  async listNeedingAttention(companyId: string, workDate?: string) {
    const date = workDate ? new Date(`${workDate}T00:00:00`) : startOfLocalDay(new Date());
    const now = new Date();

    const users = await this.prisma.user.findMany({
      where: { companyId, isActive: true, role: 'EMPLOYEE' },
      include: { department: true, workSites: { include: { workSite: true } } },
      orderBy: { employeeCode: 'asc' },
    });

    const openItems: Array<{
      kind: 'ABIERTA';
      userId: string;
      employeeCode: string;
      fullName: string;
      department: string | null;
      workSite: string | null;
      workDate: string;
      checkIn: string;
      plannedExit: string | null;
      estado: JornadaAbiertaEstado;
    }> = [];

    for (const user of users) {
      const marks = await findShiftMarks(this.prisma, user.id, date);
      if (!marks.checkIn || marks.checkOut) continue; // sin jornada abierta ese dia, o ya completa

      const { plannedShift, finalExitGraceMin } = await this.noveltiesService.getPlannedShift(user.id, date);
      let estado: JornadaAbiertaEstado;
      if (!plannedShift) {
        estado = 'SIN_HORARIO';
      } else if (now < plannedShift.end) {
        continue; // sigue dentro de su horario, jornada normal en curso
      } else {
        const graceEnd = new Date(plannedShift.end.getTime() + (finalExitGraceMin ?? DEFAULT_FINAL_EXIT_GRACE_MIN) * 60_000);
        estado = now < graceEnd ? 'PENDIENTE_CIERRE' : 'VENCIDA_CIERRE_AUTOMATICO';
      }

      openItems.push({
        kind: 'ABIERTA',
        userId: user.id,
        employeeCode: user.employeeCode,
        fullName: user.fullName,
        department: user.department?.name ?? null,
        workSite: user.workSites.map((a) => a.workSite.name).join(', ') || null,
        workDate: localDateKey(date),
        checkIn: formatHHmm(marks.checkIn),
        plannedExit: plannedShift ? formatHHmm(plannedShift.end) : null,
        estado,
      });
    }

    const pendingReviewNovelties = await this.prisma.novelty.findMany({
      where: {
        code: NoveltyCode.SALIDA_NO_REGISTRADA,
        status: PrismaNoveltyStatus.PENDIENTE,
        user: { companyId },
      },
      include: {
        user: {
          select: {
            id: true,
            employeeCode: true,
            fullName: true,
            department: { select: { name: true } },
            workSites: { include: { workSite: { select: { name: true } } } },
          },
        },
        sourceTimeLog: true,
      },
      orderBy: { workDate: 'asc' },
    });

    const reviewItems = pendingReviewNovelties.map((novelty) => ({
      kind: 'CERRADA_PENDIENTE_REVISION' as const,
      noveltyId: novelty.id,
      userId: novelty.userId,
      employeeCode: novelty.user.employeeCode,
      fullName: novelty.user.fullName,
      department: novelty.user.department?.name ?? null,
      workSite: novelty.user.workSites.map((a) => a.workSite.name).join(', ') || null,
      workDate: novelty.workDate.toISOString().slice(0, 10),
      autoClosedExit: novelty.sourceTimeLog ? formatHHmm(novelty.sourceTimeLog.loggedAt) : null,
      notes: novelty.notes,
      estado: 'CERRADA_PENDIENTE_REVISION' as JornadaAbiertaEstado,
    }));

    return [...openItems, ...reviewItems];
  }

  /** Marca una jornada cerrada automaticamente como revisada (aprobada = la salida quedo correcta, o el supervisor ya la corrigio). */
  async review(companyId: string, noveltyId: string, dto: ReviewJornadaDto, reviewedById: string) {
    const novelty = await this.prisma.novelty.findFirst({
      where: { id: noveltyId, code: NoveltyCode.SALIDA_NO_REGISTRADA, user: { companyId } },
    });
    if (!novelty) {
      throw new NotFoundException(`Novedad de jornada ${noveltyId} no encontrada`);
    }

    return this.prisma.novelty.update({
      where: { id: noveltyId },
      data: {
        status: toPrismaStatus(dto.status),
        reviewedById,
        reviewedAt: new Date(),
        notes: dto.notes ?? novelty.notes,
      },
    });
  }
}
