import { Injectable, NotFoundException } from '@nestjs/common';
import { NoveltyStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { TakeRestCreditDto } from './dto/take-rest-credit.dto';

/**
 * Creditos de descanso compensatorio (Art. 180 CST): generados por
 * NoveltiesService cuando el trabajo dominical/festivo de un empleado se
 * vuelve "habitual" en el mes calendario. Este servicio solo los lista y
 * permite marcarlos como tomados una vez la empresa agenda el descanso.
 */
@Injectable()
export class RestCreditsService {
  constructor(private readonly prisma: PrismaService) {}

  listPending(departmentId?: string) {
    return this.prisma.compensatoryRestCredit.findMany({
      where: {
        status: NoveltyStatus.PENDIENTE,
        user: departmentId ? { departmentId } : undefined,
      },
      include: {
        user: { select: { id: true, fullName: true, employeeCode: true, departmentId: true } },
      },
      orderBy: { earnedForDate: 'asc' },
    });
  }

  async take(id: string, dto: TakeRestCreditDto) {
    const credit = await this.prisma.compensatoryRestCredit.findUnique({ where: { id } });
    if (!credit) {
      throw new NotFoundException(`Credito de descanso compensatorio ${id} no encontrado`);
    }
    return this.prisma.compensatoryRestCredit.update({
      where: { id },
      data: {
        status: NoveltyStatus.APROBADA,
        takenDate: new Date(`${dto.takenDate}T00:00:00`),
      },
    });
  }
}
