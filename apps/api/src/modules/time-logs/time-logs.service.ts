import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, TimeLogSource, TimeLogType } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { addDays } from '../../common/utils/time.util';
import { haversineDistanceMeters } from '../../common/utils/geo.util';
import { findShiftMarks, resolveNextMark } from '../../common/utils/shift-marks.util';
import { saveTimeLogPhoto, deleteTimeLogPhoto } from '../../common/utils/photo-storage.util';
import { checkRecentSelfServiceMark, duplicateGuardMessage, withUserRegistrationLock } from '../../common/utils/duplicate-registration-guard.util';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { NoveltiesService } from '../novelties/novelties.service';
import { MobileClockDto } from './dto/mobile-clock.dto';
import { ManualTimeLogDto } from './dto/manual-time-log.dto';
import { CreateMarkDto } from './dto/single-mark.dto';

/** Construye una fecha local a partir de "YYYY-MM-DD" y "HH:mm". */
function localDateTime(workDate: string, hhmm: string): Date {
  const [y, m, d] = workDate.split('-').map(Number);
  const [hh, mm] = hhmm.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm, 0, 0);
}

function formatHHmm(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/**
 * Fecha calendario (YYYY-MM-DD) de un instante, en hora LOCAL del proceso
 * (Colombia, ver TZ=America/Bogota en el Dockerfile) -- a diferencia de
 * loggedAt.toISOString().slice(0,10), que da la fecha en UTC y por lo tanto
 * corre una marca nocturna (ej. 11pm Colombia = 4am UTC del dia siguiente)
 * al dia calendario equivocado.
 */
function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

const MARK_TYPE_LABELS: Record<TimeLogType, string> = {
  CHECK_IN: 'Entrada',
  LUNCH_OUT: 'Salida almuerzo',
  LUNCH_IN: 'Reingreso almuerzo',
  CHECK_OUT: 'Salida',
};

function minutesOfDay(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function addDaysToDateString(workDate: string, days: number): string {
  const d = new Date(`${workDate}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Arma las marcas de un dia a partir de horas sueltas, detectando
 * automaticamente si el turno cruza la medianoche (ej. vigilante 10pm-6am):
 * si una hora es menor a la de la marca anterior, se asume que ocurrio al
 * dia siguiente.
 */
function buildShiftMarks(
  workDate: string,
  dto: { checkIn?: string; lunchOut?: string; lunchIn?: string; checkOut?: string },
): Array<{ logType: TimeLogType; loggedAt: Date }> {
  const order: Array<[TimeLogType, string | undefined]> = [
    [TimeLogType.CHECK_IN, dto.checkIn],
    [TimeLogType.LUNCH_OUT, dto.lunchOut],
    [TimeLogType.LUNCH_IN, dto.lunchIn],
    [TimeLogType.CHECK_OUT, dto.checkOut],
  ];

  const marks: Array<{ logType: TimeLogType; loggedAt: Date }> = [];
  let currentDate = workDate;
  let prevMinutes: number | null = null;

  for (const [logType, hhmm] of order) {
    if (!hhmm) continue;
    const minutes = minutesOfDay(hhmm);
    if (prevMinutes !== null && minutes < prevMinutes) {
      currentDate = addDaysToDateString(currentDate, 1);
    }
    marks.push({ logType, loggedAt: localDateTime(currentDate, hhmm) });
    prevMinutes = minutes;
  }

  return marks;
}

/** Modo Empleado (autoservicio): marcaje desde el telefono personal, validado por GPS contra la sede asignada. */
@Injectable()
export class TimeLogsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly noveltiesService: NoveltiesService,
  ) {}

  async mobileClock(userId: string, dto: MobileClockDto) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { workSite: true } });
    if (!user.workSite) {
      throw new BadRequestException('No tienes una sede asignada para validar tu ubicacion.');
    }
    if (user.workSite.latitude === null || user.workSite.longitude === null) {
      throw new BadRequestException('La sede asignada no tiene coordenadas configuradas.');
    }

    const distanceMeters = haversineDistanceMeters(
      dto.latitude,
      dto.longitude,
      user.workSite.latitude.toNumber(),
      user.workSite.longitude.toNumber(),
    );
    const gpsValid = distanceMeters <= user.workSite.gpsRadiusMeters;
    if (!gpsValid) {
      throw new BadRequestException(
        `Estas a ${Math.round(distanceMeters)}m de "${user.workSite.name}" (radio permitido: ${user.workSite.gpsRadiusMeters}m).`,
      );
    }

    const now = new Date();
    // La interpretacion de la marca se basa en el horario REAL asignado al
    // empleado (ver comentario en resolveNextMark/shift-marks.util.ts), no
    // en adivinar por secuencia.
    const context = await this.noveltiesService.resolveMarkContext(userId, now);
    const resolved = await resolveNextMark(this.prisma, userId, now, context);
    if (!resolved) {
      throw new BadRequestException('Ya completaste las 4 marcas de hoy.');
    }

    // Chequeo rapido (sin lock) ANTES de tocar la foto: cubre el caso comun
    // de un doble-toque accidental sin gastar el guardado/redimension de la
    // imagen. El chequeo autoritativo (con lock, ver mas abajo) es el que
    // realmente cierra la condicion de carrera entre dos dispositivos.
    const earlyCheck = await checkRecentSelfServiceMark(this.prisma, userId, now);
    if (earlyCheck?.blocked) {
      throw new BadRequestException({ message: duplicateGuardMessage(earlyCheck), secondsRemaining: earlyCheck.secondsRemaining });
    }

    const photoUrl = dto.imageBase64 ? await saveTimeLogPhoto(dto.imageBase64, 'mobile') : undefined;

    try {
      await withUserRegistrationLock(this.prisma, userId, async (tx) => {
        const finalCheck = await checkRecentSelfServiceMark(tx, userId, now);
        if (finalCheck?.blocked) {
          throw new BadRequestException({ message: duplicateGuardMessage(finalCheck), secondsRemaining: finalCheck.secondsRemaining });
        }

        await tx.timeLog.create({
          data: {
            userId,
            workSiteId: user.workSiteId,
            logType: resolved.nextLogType,
            loggedAt: now,
            source: TimeLogSource.MOBILE_GPS,
            latitude: dto.latitude,
            longitude: dto.longitude,
            gpsValid,
            photoUrl,
          },
        });
      });
    } catch (err) {
      // La marca no quedo creada (bloqueada por el guard, o cualquier otro
      // error): no dejar la foto huerfana en disco.
      if (photoUrl) deleteTimeLogPhoto(photoUrl);
      throw err;
    }

    await this.noveltiesService.calculateAndPersistForDay(userId, resolved.workDate);

    return { logType: resolved.nextLogType, loggedAt: now, distanceMeters: Math.round(distanceMeters), reason: resolved.reason };
  }

  /**
   * Carga manual (calculo de nomina): reemplaza las marcas de un dia especifico
   * a partir de horas sueltas (ej. traidas de una planilla en papel/Excel) y
   * recalcula las novedades de ese dia, reutilizando el mismo motor que usan
   * el kiosco y el autoservicio movil.
   */
  /**
   * Calcula el rango [start, end) de TimeLogs a borrar para reemplazar/
   * limpiar las marcas de un dia especifico, sin tocar un turno nocturno
   * distinto que haya quedado guardado cruzando la medianoche (ni el de
   * ayer, ni el de un dia siguiente separado). Compartido por
   * upsertManualDay y deleteManualDay.
   */
  private async computeDeleteRange(userId: string, workDate: string): Promise<{ start: Date; end: Date }> {
    const dayStart = new Date(`${workDate}T00:00:00`);
    const dayEnd = addDays(dayStart, 1);

    const existingCheckIn = await this.prisma.timeLog.findFirst({
      where: { userId, logType: TimeLogType.CHECK_IN, loggedAt: { gte: dayStart, lt: dayEnd } },
    });
    let end = dayEnd;
    if (existingCheckIn) {
      const searchEnd = addDays(existingCheckIn.loggedAt, 1);
      const nextCheckIn = await this.prisma.timeLog.findFirst({
        where: { userId, logType: TimeLogType.CHECK_IN, loggedAt: { gt: existingCheckIn.loggedAt, lt: searchEnd } },
        orderBy: { loggedAt: 'asc' },
      });
      end = nextCheckIn?.loggedAt ?? searchEnd;
    }

    const yesterdayMarks = await findShiftMarks(this.prisma, userId, addDays(dayStart, -1));
    let start = dayStart;
    for (const mark of [yesterdayMarks.lunchOut, yesterdayMarks.lunchIn, yesterdayMarks.checkOut]) {
      if (mark && mark >= start && mark < dayEnd) {
        start = new Date(mark.getTime() + 1);
      }
    }

    return { start, end };
  }

  async upsertManualDay(companyId: string, dto: ManualTimeLogDto) {
    const user = await this.prisma.user.findFirst({ where: { id: dto.userId, companyId } });
    if (!user) throw new NotFoundException(`Empleado ${dto.userId} no encontrado`);

    // El turno pudo haber quedado guardado previamente cruzando la
    // medianoche (ej. vigilante 10pm-6am); hay que borrar tambien esas
    // marcas para no dejar residuos duplicados, sin tocar el turno del dia
    // siguiente si es uno distinto.
    const { start: deleteRangeStart, end: deleteRangeEnd } = await this.computeDeleteRange(dto.userId, dto.workDate);
    const marks = buildShiftMarks(dto.workDate, dto);

    await this.prisma.$transaction([
      this.prisma.timeLog.deleteMany({ where: { userId: dto.userId, loggedAt: { gte: deleteRangeStart, lt: deleteRangeEnd } } }),
      ...marks.map((mark) =>
        this.prisma.timeLog.create({
          data: { userId: dto.userId, workSiteId: user.workSiteId, logType: mark.logType, loggedAt: mark.loggedAt, source: TimeLogSource.MANUAL },
        }),
      ),
    ]);

    return this.noveltiesService.calculateAndPersistForDay(dto.userId, dto.workDate);
  }

  /** Borra TODAS las marcas de un dia especifico de un empleado (sin reemplazarlas) y recalcula sus novedades. */
  async deleteManualDay(companyId: string, userId: string, workDate: string) {
    const user = await this.prisma.user.findFirst({ where: { id: userId, companyId } });
    if (!user) throw new NotFoundException(`Empleado ${userId} no encontrado`);

    const { start, end } = await this.computeDeleteRange(userId, workDate);
    await this.prisma.timeLog.deleteMany({ where: { userId, loggedAt: { gte: start, lt: end } } });

    return this.noveltiesService.calculateAndPersistForDay(userId, workDate);
  }

  /**
   * Historial de marcas de un empleado con coordenadas y foto de evidencia,
   * para el modulo de historial (web y mobile). Un EMPLOYEE solo puede ver
   * su propio historial (se ignora cualquier userId ajeno que llegue en la
   * query); ADMIN/HR/SUPERVISOR pueden consultar el de cualquier empleado de
   * su misma empresa.
   */
  async getHistory(currentUser: AuthenticatedUser, requestedUserId: string | undefined, from: string, to: string) {
    const targetUserId = currentUser.role === 'EMPLOYEE' ? currentUser.id : requestedUserId;
    if (!targetUserId) throw new BadRequestException('userId es requerido');

    const user = await this.prisma.user.findFirst({ where: { id: targetUserId, companyId: currentUser.companyId } });
    if (!user) throw new NotFoundException(`Empleado ${targetUserId} no encontrado`);

    const rangeStart = new Date(`${from}T00:00:00`);
    const rangeEnd = addDays(new Date(`${to}T00:00:00`), 1);

    const logs = await this.prisma.timeLog.findMany({
      where: { userId: targetUserId, loggedAt: { gte: rangeStart, lt: rangeEnd } },
      include: { workSite: true },
      orderBy: { loggedAt: 'desc' },
    });

    return logs.map((log) => ({
      id: log.id,
      logType: log.logType,
      loggedAt: log.loggedAt,
      source: log.source,
      latitude: log.latitude ? log.latitude.toNumber() : null,
      longitude: log.longitude ? log.longitude.toNumber() : null,
      gpsValid: log.gpsValid,
      photoUrl: log.photoUrl,
      workSite: log.workSite?.name ?? null,
    }));
  }

  /**
   * Trae las marcas y novedades ya guardadas de un empleado en un rango, para
   * precargar el formulario de carga manual. Las marcas se resuelven dia por
   * dia con la misma logica cronologica que usa el motor de calculo, para
   * que un turno nocturno (ej. vigilante 10pm-6am) se muestre completo bajo
   * el dia en que empezo, no partido entre dos filas.
   */
  async getManualRange(companyId: string, userId: string, from: string, to: string) {
    const user = await this.prisma.user.findFirst({ where: { id: userId, companyId } });
    if (!user) throw new NotFoundException(`Empleado ${userId} no encontrado`);

    const rangeStart = new Date(`${from}T00:00:00`);
    const rangeEnd = addDays(new Date(`${to}T00:00:00`), 1);

    const [novelties, totals, rawMarks] = await Promise.all([
      this.prisma.novelty.findMany({
        where: { userId, workDate: { gte: rangeStart, lt: rangeEnd } },
        orderBy: { workDate: 'asc' },
      }),
      this.prisma.attendanceDailyTotal.findMany({
        where: { userId, workDate: { gte: rangeStart, lt: rangeEnd } },
      }),
      this.prisma.timeLog.findMany({
        where: { userId, loggedAt: { gte: rangeStart, lt: rangeEnd } },
        orderBy: { loggedAt: 'asc' },
      }),
    ]);

    // Lista real de marcas por dia calendario (no por tipo, como
    // findShiftMarks): si hay una marca duplicada o fuera de secuencia,
    // findShiftMarks la esconde (solo toma la primera de cada tipo); esta
    // lista muestra TODO lo que realmente hay ese dia, para poder editarlo.
    const marksByDate = new Map<string, Array<{ id: string; logType: TimeLogType; time: string; source: string }>>();
    for (const mark of rawMarks) {
      const key = localDateKey(mark.loggedAt);
      const list = marksByDate.get(key) ?? [];
      list.push({ id: mark.id, logType: mark.logType, time: formatHHmm(mark.loggedAt), source: mark.source });
      marksByDate.set(key, list);
    }

    const noveltiesByDate = new Map<string, Array<{ code: string; hours: number; status: string }>>();
    for (const novelty of novelties) {
      const key = novelty.workDate.toISOString().slice(0, 10);
      const list = noveltiesByDate.get(key) ?? [];
      list.push({ code: novelty.code, hours: novelty.hours.toNumber(), status: novelty.status });
      noveltiesByDate.set(key, list);
    }

    const totalsByDate = new Map<string, { totalOrdinaryHours: number; totalOvertimeHours: number; totalWorkedHours: number }>();
    for (const total of totals) {
      const key = total.workDate.toISOString().slice(0, 10);
      totalsByDate.set(key, {
        totalOrdinaryHours: total.totalOrdinaryHours.toNumber(),
        totalOvertimeHours: total.totalOvertimeHours.toNumber(),
        totalWorkedHours: total.totalWorkedHours.toNumber(),
      });
    }

    const results = [];
    for (let day = rangeStart; day < rangeEnd; day = addDays(day, 1)) {
      const workDate = day.toISOString().slice(0, 10);
      const marks = await findShiftMarks(this.prisma, userId, day);
      const total = totalsByDate.get(workDate);
      results.push({
        workDate,
        checkIn: marks.checkIn ? formatHHmm(marks.checkIn) : undefined,
        lunchOut: marks.lunchOut ? formatHHmm(marks.lunchOut) : undefined,
        lunchIn: marks.lunchIn ? formatHHmm(marks.lunchIn) : undefined,
        checkOut: marks.checkOut ? formatHHmm(marks.checkOut) : undefined,
        marks: marksByDate.get(workDate) ?? [],
        novelties: noveltiesByDate.get(workDate) ?? [],
        totalOrdinaryHours: total?.totalOrdinaryHours ?? 0,
        totalOvertimeHours: total?.totalOvertimeHours ?? 0,
        totalWorkedHours: total?.totalWorkedHours ?? 0,
      });
    }

    return results;
  }

  /** Cambia solo la hora de una marca puntual ya existente (mantiene su dia calendario). */
  async updateMark(companyId: string, id: string, hhmm: string) {
    const mark = await this.prisma.timeLog.findFirst({ where: { id }, include: { user: true } });
    if (!mark || mark.user.companyId !== companyId) throw new NotFoundException(`Marca ${id} no encontrada`);

    const [hh, mm] = hhmm.split(':').map(Number);
    const newLoggedAt = new Date(mark.loggedAt);
    newLoggedAt.setHours(hh, mm, 0, 0);

    try {
      await this.prisma.timeLog.update({
        where: { id },
        data: { loggedAt: newLoggedAt, source: TimeLogSource.MANUAL },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new BadRequestException(
          `Ya existe otra marca de tipo "${MARK_TYPE_LABELS[mark.logType]}" en el dia al que cambiaste la hora.`,
        );
      }
      throw err;
    }

    return this.noveltiesService.calculateAndPersistForDay(mark.userId, localDateKey(newLoggedAt));
  }

  /** Borra una marca puntual (no el dia completo) y recalcula las novedades de su dia. */
  async deleteMark(companyId: string, id: string) {
    const mark = await this.prisma.timeLog.findFirst({ where: { id }, include: { user: true } });
    if (!mark || mark.user.companyId !== companyId) throw new NotFoundException(`Marca ${id} no encontrada`);

    const workDate = localDateKey(mark.loggedAt);
    await this.prisma.timeLog.delete({ where: { id } });
    return this.noveltiesService.calculateAndPersistForDay(mark.userId, workDate);
  }

  /** Agrega una marca puntual nueva (ej. el empleado olvido marcar la salida). */
  async createMark(companyId: string, dto: CreateMarkDto) {
    const user = await this.prisma.user.findFirst({ where: { id: dto.userId, companyId } });
    if (!user) throw new NotFoundException(`Empleado ${dto.userId} no encontrado`);

    try {
      await this.prisma.timeLog.create({
        data: {
          userId: dto.userId,
          workSiteId: user.workSiteId,
          logType: dto.logType,
          loggedAt: localDateTime(dto.workDate, dto.time),
          source: TimeLogSource.MANUAL,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new BadRequestException(
          `Ya existe una marca de tipo "${MARK_TYPE_LABELS[dto.logType]}" ese dia. Edita o borra la existente en vez de agregar otra.`,
        );
      }
      throw err;
    }

    return this.noveltiesService.calculateAndPersistForDay(dto.userId, dto.workDate);
  }

  /**
   * Resuelve el rango de fechas y el filtro de usuario para un borrado
   * masivo, validando que un userId puntual (si viene) pertenezca a la
   * empresa -- para no poder borrar marcas de otra empresa pasando un id
   * ajeno.
   */
  private async resolveBulkScope(companyId: string, from: string, to: string, userId?: string) {
    if (!from || !to) throw new BadRequestException('Debes indicar una fecha "desde" y "hasta".');
    const rangeStart = new Date(`${from}T00:00:00`);
    const rangeEnd = addDays(new Date(`${to}T00:00:00`), 1);
    if (Number.isNaN(rangeStart.getTime()) || Number.isNaN(rangeEnd.getTime())) {
      throw new BadRequestException('Fechas invalidas.');
    }
    if (rangeStart >= rangeEnd) throw new BadRequestException('La fecha "desde" debe ser anterior o igual a "hasta".');

    if (userId) {
      const user = await this.prisma.user.findFirst({ where: { id: userId, companyId } });
      if (!user) throw new NotFoundException(`Empleado ${userId} no encontrado`);
      return { rangeStart, rangeEnd, userIds: [userId] };
    }
    const companyUsers = await this.prisma.user.findMany({ where: { companyId }, select: { id: true } });
    return { rangeStart, rangeEnd, userIds: companyUsers.map((u) => u.id) };
  }

  /**
   * Cuenta cuantas marcas/novedades/totales se borrarian con estos filtros,
   * SIN borrar nada -- para que el panel administrativo pueda mostrar un
   * numero antes de pedir confirmacion de un borrado irreversible.
   */
  async previewBulkDelete(companyId: string, from: string, to: string, userId?: string) {
    const { rangeStart, rangeEnd, userIds } = await this.resolveBulkScope(companyId, from, to, userId);

    const timeLogIds = (
      await this.prisma.timeLog.findMany({
        where: { loggedAt: { gte: rangeStart, lt: rangeEnd }, userId: { in: userIds } },
        select: { id: true, userId: true },
      })
    );

    const [noveltiesCount, totalsCount] = await Promise.all([
      this.prisma.novelty.count({
        where: {
          userId: { in: userIds },
          OR: [{ workDate: { gte: rangeStart, lt: rangeEnd } }, { sourceTimeLogId: { in: timeLogIds.map((t) => t.id) } }],
        },
      }),
      this.prisma.attendanceDailyTotal.count({ where: { workDate: { gte: rangeStart, lt: rangeEnd }, userId: { in: userIds } } }),
    ]);

    return {
      timeLogsCount: timeLogIds.length,
      noveltiesCount,
      totalsCount,
      usersAffected: new Set(timeLogIds.map((t) => t.userId)).size,
    };
  }

  /**
   * Borra TODAS las marcas (y las novedades/totales derivados de ellas) de
   * un rango de fechas -- de un empleado puntual, o de toda la empresa si
   * no se pasa userId. Irreversible: no hay papelera ni backup automatico,
   * por eso queda registrado en AuditLog con quien lo hizo y cuantas filas
   * se borraron.
   *
   * Orden de borrado: primero las Novelty (evita violar la FK
   * sourceTimeLogId -> TimeLog; su cascade se lleva de paso cualquier
   * OvertimeApproval asociada), luego los totales, y al final los TimeLog
   * por id (no por rango de fecha de nuevo, para no arrastrar un turno
   * nocturno que haya quedado guardado cruzando la medianoche fuera del
   * rango original).
   */
  async bulkDelete(companyId: string, performedById: string, from: string, to: string, userId?: string) {
    const { rangeStart, rangeEnd, userIds } = await this.resolveBulkScope(companyId, from, to, userId);

    const timeLogIds = (
      await this.prisma.timeLog.findMany({
        where: { loggedAt: { gte: rangeStart, lt: rangeEnd }, userId: { in: userIds } },
        select: { id: true },
      })
    ).map((t) => t.id);

    const [deletedNovelties, deletedTotals, deletedLogs] = await this.prisma.$transaction([
      this.prisma.novelty.deleteMany({
        where: {
          userId: { in: userIds },
          OR: [{ workDate: { gte: rangeStart, lt: rangeEnd } }, { sourceTimeLogId: { in: timeLogIds } }],
        },
      }),
      this.prisma.attendanceDailyTotal.deleteMany({ where: { workDate: { gte: rangeStart, lt: rangeEnd }, userId: { in: userIds } } }),
      this.prisma.timeLog.deleteMany({ where: { id: { in: timeLogIds } } }),
    ]);

    await this.prisma.auditLog.create({
      data: {
        companyId,
        userId: performedById,
        entity: 'TimeLog',
        action: 'BULK_DELETE',
        diff: {
          from,
          to,
          scopeUserId: userId ?? null,
          timeLogsDeleted: deletedLogs.count,
          noveltiesDeleted: deletedNovelties.count,
          totalsDeleted: deletedTotals.count,
        },
      },
    });

    return {
      timeLogsDeleted: deletedLogs.count,
      noveltiesDeleted: deletedNovelties.count,
      totalsDeleted: deletedTotals.count,
    };
  }
}
