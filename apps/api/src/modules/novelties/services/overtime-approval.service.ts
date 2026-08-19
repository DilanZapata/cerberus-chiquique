import { Injectable, NotFoundException } from '@nestjs/common';
import { NoveltyStatus as PrismaNoveltyStatus, NoveltyCode as PrismaNoveltyCode } from '@prisma/client';
import { NoveltyStatus } from '@cerberus/shared-types';
import { PrismaService } from '../../../database/prisma.service';
import { ReviewNoveltyDto } from '../dto/review-novelty.dto';

function toPrismaStatus(status: NoveltyStatus): PrismaNoveltyStatus {
  return status as unknown as PrismaNoveltyStatus;
}

// Conceptos individuales de hora extra que acompanan a la novedad agregada
// HORA_EXTRA_PENDIENTE y alimentan el reporte de nomina (seccion 3 del brief).
const OVERTIME_DETAIL_CODES: PrismaNoveltyCode[] = ['HEOD', 'HEON', 'HEFD', 'HEFN'] as PrismaNoveltyCode[];

/**
 * Panel de aprobacion de horas extra (seccion C.2 del brief): permite a un
 * supervisor/HR auditar y decidir sobre las horas extra que el motor de
 * calculo dejo en estado PENDIENTE por falta de autorizacion previa.
 */
@Injectable()
export class OvertimeApprovalService {
  constructor(private readonly prisma: PrismaService) {}

  async listPending(departmentId?: string) {
    return this.prisma.overtimeApproval.findMany({
      where: {
        status: PrismaNoveltyStatus.PENDIENTE,
        novelty: {
          user: departmentId ? { departmentId } : undefined,
        },
      },
      include: {
        novelty: {
          include: {
            user: { select: { id: true, fullName: true, employeeCode: true, departmentId: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async review(overtimeApprovalId: string, dto: ReviewNoveltyDto, reviewedById: string) {
    const approval = await this.prisma.overtimeApproval.findUnique({
      where: { id: overtimeApprovalId },
      include: { novelty: true },
    });
    if (!approval) {
      throw new NotFoundException(`Solicitud de hora extra ${overtimeApprovalId} no encontrada`);
    }

    const approvedHours =
      dto.status === NoveltyStatus.APROBADA
        ? (dto.approvedHours ?? approval.requestedHours.toNumber())
        : 0;

    const [updatedApproval] = await this.prisma.$transaction([
      this.prisma.overtimeApproval.update({
        where: { id: overtimeApprovalId },
        data: {
          status: toPrismaStatus(dto.status),
          approvedHours,
          decidedById: reviewedById,
          decidedAt: new Date(),
          decisionNotes: dto.notes,
        },
      }),
      this.prisma.novelty.update({
        where: { id: approval.noveltyId },
        data: {
          status: toPrismaStatus(dto.status),
          hours: dto.status === NoveltyStatus.APROBADA ? approvedHours : approval.novelty.hours,
          reviewedById,
          reviewedAt: new Date(),
        },
      }),
      // Propaga la decision a las filas HEOD/HEON/HEFD/HEFN del mismo dia,
      // que son las que efectivamente alimentan el reporte de nomina.
      this.prisma.novelty.updateMany({
        where: {
          userId: approval.novelty.userId,
          workDate: approval.novelty.workDate,
          code: { in: OVERTIME_DETAIL_CODES },
          status: PrismaNoveltyStatus.PENDIENTE,
        },
        data: {
          status: toPrismaStatus(dto.status),
          reviewedById,
          reviewedAt: new Date(),
        },
      }),
    ]);

    return updatedApproval;
  }
}
