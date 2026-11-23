import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma, TimeLogSource, TimeLogType, NoveltyCode, NoveltyOrigin, NoveltyStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { addDays, startOfLocalDay } from '../../common/utils/time.util';
import { findShiftMarks } from '../../common/utils/shift-marks.util';
import { NoveltiesService } from '../novelties/novelties.service';

export const LOOKBACK_DAYS = 3;
// Barrido lento (una vez al dia) para jornadas abiertas MAS ANTIGUAS que
// LOOKBACK_DAYS: el barrido rapido de cada 30 min nunca vuelve a mirar atras
// de esa ventana, asi que una jornada que quedo abierta mas tiempo que eso
// (por una falla del kiosco, una ausencia prolongada mal registrada, etc.)
// quedaba abierta para siempre, sin que nadie la detectara (hallazgo C.3 /
// F.5 de la auditoria 2026-10-16). Un rango de 2 anios es, en la practica,
// "sin limite" para este sistema, sin escanear la tabla completa de marcas
// desde el origen de los tiempos en cada ejecucion.
export const SLOW_SWEEP_LOOKBACK_DAYS = 730;
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
    // Repaso del corte de medianoche, por si el de las 00:00 no alcanzo a correr.
    await this.runMidnightHandover();
    return this.closeOverdueOpenShiftsSince(LOOKBACK_DAYS);
  }

  /**
   * Corte de medianoche: a las 00:00, a quien sigue trabajando en un turno
   * que cruza la medianoche se le pone la salida del dia que termina
   * (23:59:59) y la entrada del dia que empieza (00:00). Ver
   * `NoveltiesService.midnightHandover`.
   */
  @Cron('0 0 * * *', { timeZone: 'America/Bogota' })
  async runMidnightHandover(now: Date = new Date()) {
    const today = startOfLocalDay(now);
    const yesterday = addDays(today, -1);
    // Candidatos: quien tenga alguna marca de ayer.
    const logs = await this.prisma.timeLog.findMany({
      where: { loggedAt: { gte: yesterday, lt: today } },
      select: { userId: true },
      distinct: ['userId'],
    });
    let handedOver = 0;
    for (const { userId } of logs) {
      try {
        if (await this.noveltiesService.midnightHandover(userId, yesterday, now)) handedOver++;
      } catch (error) {
        this.logger.error(`Fallo el corte de medianoche del usuario ${userId}: ${(error as Error).message}`);
      }
    }
    return { evaluated: logs.length, handedOver };
  }

  /**
   * Barrido lento, una vez al dia: cubre jornadas abiertas de hasta
   * `SLOW_SWEEP_LOOKBACK_DAYS` de antiguedad, que el barrido rapido de arriba
   * (acotado a `LOOKBACK_DAYS`) nunca vuelve a mirar. Corre a una hora de
   * baja actividad (3:17am Bogota) para no competir con el barrido rapido.
   */
  @Cron('17 3 * * *', { timeZone: 'America/Bogota' })
  async closeStaleOpenShifts() {
    return this.closeOverdueOpenShiftsSince(SLOW_SWEEP_LOOKBACK_DAYS);
  }

  private async closeOverdueOpenShiftsSince(lookbackDays: number) {
    const now = new Date();
    const lookbackStart = addDays(startOfLocalDay(now), -lookbackDays);

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
    // Si la persona seguia trabajando a medianoche, ese dia se cierra con el
    // corte de medianoche (salida 23:59:59 + entrada del dia siguiente), no
    // con un cierre por olvido.
    await this.noveltiesService.midnightHandover(userId, dayStart, now);
    const marks = await findShiftMarks(this.prisma, userId, dayStart);
    if (!marks.checkIn || marks.checkOut) return false;

    const plan = await this.noveltiesService.getPlannedShift(userId, dayStart);
    const { plannedShift, finalExitGraceMin } = plan;
    if (!plannedShift) return false; // sin horario resuelto: no se auto-cierra, queda para revision manual

    const graceMinutes = finalExitGraceMin ?? DEFAULT_FINAL_EXIT_GRACE_MIN;

    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { companyId: true },
    });
    // Una persona puede tener varias sedes asignadas: no hay "la" sede para
    // grabar en el cierre automatico. Se usa la misma sede que ya quedo en
    // su CHECK_IN real de ese dia -- la sede donde de verdad entro.
    const checkInLog = await this.prisma.timeLog.findFirst({
      where: { userId, logType: TimeLogType.CHECK_IN, loggedAt: marks.checkIn },
      select: { workSiteId: true },
    });

    // Dia partido por la medianoche (ej. 00:00-06:00 y 22:00-24:00): si la
    // persona trabajo el primer bloque y se le olvido marcar la salida al
    // descanso, se le pone a la hora programada y queda para revision. Asi su
    // marca de la noche se entiende como la entrada de descanso, no como una
    // salida a descanso tardia.
    if (plan.dayBreak && !marks.lunchOut && marks.checkIn < plan.dayBreak.start) {
      if (now < new Date(plan.dayBreak.start.getTime() + graceMinutes * 60_000)) return false;
      let breakLogId: string;
      try {
        const created = await this.prisma.timeLog.create({
          data: {
            userId,
            workSiteId: checkInLog?.workSiteId,
            logType: TimeLogType.LUNCH_OUT,
            loggedAt: plan.dayBreak.start,
            source: TimeLogSource.AUTO_CLOSE,
          },
        });
        breakLogId = created.id;
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return false;
        throw err;
      }
      await this.noveltiesService.calculateAndPersistForDay(userId, workDate);
      await this.prisma.novelty.create({
        data: {
          userId,
          workDate: dayStart,
          code: NoveltyCode.SALIDA_NO_REGISTRADA,
          hours: 0,
          status: NoveltyStatus.PENDIENTE,
          origin: NoveltyOrigin.MANUAL,
          sourceTimeLogId: breakLogId,
          notes:
            'La persona no registro su salida a descanso. El sistema la puso a la hora programada de fin del primer bloque del turno. Verificar a que hora salio realmente.',
        },
      });
      await this.prisma.auditLog.create({
        data: {
          companyId: user.companyId,
          userId,
          entity: 'TimeLog',
          entityId: breakLogId,
          action: 'AUTO_CLOSE',
          diff: { workDate, ruleUsed: 'dayBreak.start + finalExitGraceMin', breakStart: plan.dayBreak.start.toISOString(), graceMinutes, evaluatedAt: now.toISOString() },
        },
      });
      return true;
    }

    const graceEnd = new Date(plannedShift.end.getTime() + graceMinutes * 60_000);
    if (now < graceEnd) return false;

    // La salida automatica nunca se pasa al dia siguiente: un dia que llega
    // hasta la medianoche se cierra a las 23:59:59 de ese mismo dia.
    const lastSecondOfDay = new Date(addDays(dayStart, 1).getTime() - 1000);
    const closeAt = plan.splitByMidnight && plannedShift.end > lastSecondOfDay ? lastSecondOfDay : plannedShift.end;

    let createdLogId: string;
    try {
      const created = await this.prisma.timeLog.create({
        data: {
          userId,
          workSiteId: checkInLog?.workSiteId,
          logType: TimeLogType.CHECK_OUT,
          loggedAt: closeAt,
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
          marks.lunchOut && !marks.lunchIn
            ? 'La persona salio a su descanso y no registro el regreso. La jornada fue cerrada automaticamente; solo cuenta lo trabajado antes del descanso.'
            : 'La persona no registro salida manualmente. La jornada fue cerrada automaticamente durante el proceso de cierre diario. Se asigno como hora de salida la hora programada de finalizacion de su turno.',
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
