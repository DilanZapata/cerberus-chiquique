import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma, TimeLogSource, TimeLogType, NoveltyCode, NoveltyOrigin, NoveltyStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { addDays, startOfLocalDay } from '../../common/utils/time.util';
import { findShiftMarks } from '../../common/utils/shift-marks.util';
import { NoveltiesService } from '../novelties/novelties.service';

export const LOOKBACK_DAYS = 3;
// Margen por defecto (minutos) tras la hora de salida programada antes de
// considerar una jornada "abierta e incompleta" y candidata a cierre
// automatico, usado solo cuando el horario resuelto no trae su propio
// Schedule.finalExitGraceMin (ej. turno de rutina rotativa). Exportada para
// que jornadas-abiertas.service.ts clasifique el mismo estado sin duplicar
// el numero.
export const DEFAULT_FINAL_EXIT_GRACE_MIN = 180;

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/**
 * Cierra automaticamente jornadas que quedaron abiertas (con CHECK_IN pero
 * sin CHECK_OUT) mucho despues de la hora de salida programada del
 * empleado, dejando una novedad de origen MANUAL pendiente de revision (no
 * SISTEMA: persist() en NoveltiesService solo reemplaza novedades SISTEMA en
 * cada recalculo, asi que esta debe sobrevivir hasta que un supervisor la
 * revise) y un registro de auditoria completo. Nunca inventa una hora si no
 * hay horario resuelto para ese dia -- en ese caso deja la jornada abierta
 * para revision manual en vez de adivinar.
 */
@Injectable()
export class JornadaCierreService {
  private readonly logger = new Logger(JornadaCierreService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly noveltiesService: NoveltiesService,
  ) {}

  @Cron('*/30 * * * *', { timeZone: 'America/Bogota' })
  async closeOverdueOpenShifts() {
    const now = new Date();
    const lookbackStart = addDays(startOfLocalDay(now), -LOOKBACK_DAYS);

    const checkIns = await this.prisma.timeLog.findMany({
      where: { logType: TimeLogType.CHECK_IN, loggedAt: { gte: lookbackStart, lte: now } },
      select: { userId: true, loggedAt: true },
    });

    const seen = new Set<string>();
    const closed: Array<{ userId: string; workDate: string }> = [];
    for (const checkIn of checkIns) {
      const workDate = localDateKey(checkIn.loggedAt);
      const key = `${checkIn.userId}|${workDate}`;
      if (seen.has(key)) continue;
      seen.add(key);

      try {
        const wasClosed = await this.evaluateAndCloseIfNeeded(checkIn.userId, workDate, now);
        if (wasClosed) closed.push({ userId: checkIn.userId, workDate });
      } catch (error) {
        this.logger.error(`Fallo evaluando cierre automatico para usuario ${checkIn.userId}, dia ${workDate}: ${(error as Error).message}`);
      }
    }

    return { evaluated: seen.size, closed };
  }

  /** Devuelve true si esta ejecucion realmente cerro una jornada (para reportar en el disparo manual de pruebas). */
  private async evaluateAndCloseIfNeeded(userId: string, workDate: string, now: Date): Promise<boolean> {
    const dayStart = new Date(`${workDate}T00:00:00`);
    const marks = await findShiftMarks(this.prisma, userId, dayStart);
    if (!marks.checkIn || marks.checkOut) return false;

    const { plannedShift, finalExitGraceMin } = await this.noveltiesService.getPlannedShift(userId, dayStart);
    if (!plannedShift) return false; // sin horario resuelto: no se auto-cierra, queda para revision manual

    const graceMinutes = finalExitGraceMin ?? DEFAULT_FINAL_EXIT_GRACE_MIN;
    const graceEnd = new Date(plannedShift.end.getTime() + graceMinutes * 60_000);
    if (now < graceEnd) return false;

    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { companyId: true, workSiteId: true },
    });

    let createdLogId: string;
    try {
      const created = await this.prisma.timeLog.create({
        data: {
          userId,
          workSiteId: user.workSiteId,
          logType: TimeLogType.CHECK_OUT,
          loggedAt: plannedShift.end,
          source: TimeLogSource.AUTO_CLOSE,
        },
      });
      createdLogId = created.id;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return false; // otra ejecucion concurrente ya cerro esta jornada
      }
      throw err;
    }

    await this.noveltiesService.calculateAndPersistForDay(userId, workDate);

    // origin MANUAL (no SISTEMA) para que persist() no la borre en el proximo recalculo.
    await this.prisma.novelty.create({
      data: {
        userId,
        workDate: dayStart,
        code: NoveltyCode.SALIDA_NO_REGISTRADA,
        hours: 0,
        status: NoveltyStatus.PENDIENTE,
        origin: NoveltyOrigin.MANUAL,
        sourceTimeLogId: createdLogId,
        notes:
          'La persona no registro salida manualmente. La jornada fue cerrada automaticamente durante el proceso de cierre diario. Se asigno como hora de salida la hora programada de finalizacion de su turno.',
      },
    });

    await this.prisma.auditLog.create({
      data: {
        companyId: user.companyId,
        userId,
        entity: 'TimeLog',
        entityId: createdLogId,
        action: 'AUTO_CLOSE',
        diff: {
          workDate,
          ruleUsed: 'plannedShift.end + Schedule.finalExitGraceMin',
          plannedShiftEnd: plannedShift.end.toISOString(),
          graceMinutes,
          evaluatedAt: now.toISOString(),
        },
      },
    });

    return true;
  }
}
