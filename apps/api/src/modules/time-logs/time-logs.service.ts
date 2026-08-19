import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { TimeLogSource, TimeLogType } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { addDays } from '../../common/utils/time.util';
import { haversineDistanceMeters } from '../../common/utils/geo.util';
import { findShiftMarks, resolveNextMark } from '../../common/utils/shift-marks.util';
import { saveTimeLogPhoto } from '../../common/utils/photo-storage.util';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { NoveltiesService } from '../novelties/novelties.service';
import { MobileClockDto } from './dto/mobile-clock.dto';
import { ManualTimeLogDto } from './dto/manual-time-log.dto';

/** Construye una fecha local a partir de "YYYY-MM-DD" y "HH:mm". */
function localDateTime(workDate: string, hhmm: string): Date {
  const [y, m, d] = workDate.split('-').map(Number);
  const [hh, mm] = hhmm.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm, 0, 0);
}

function formatHHmm(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

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
    // Si anoche quedo un turno sin cerrar (ej. vigilante que entro a las
    // 10pm), continua ese turno en vez de asumir que hoy empieza uno nuevo.
    const resolved = await resolveNextMark(this.prisma, userId, now);
    if (!resolved) {
      throw new BadRequestException('Ya completaste las 4 marcas de hoy.');
    }

    const photoUrl = dto.imageBase64 ? await saveTimeLogPhoto(dto.imageBase64, 'mobile') : undefined;

    await this.prisma.timeLog.create({
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

    await this.noveltiesService.calculateAndPersistForDay(userId, resolved.workDate);

    return { logType: resolved.nextLogType, loggedAt: now, distanceMeters: Math.round(distanceMeters) };
  }

  /**
   * Carga manual (calculo de nomina): reemplaza las marcas de un dia especifico
   * a partir de horas sueltas (ej. traidas de una planilla en papel/Excel) y
   * recalcula las novedades de ese dia, reutilizando el mismo motor que usan
   * el kiosco y el autoservicio movil.
   */
  async upsertManualDay(companyId: string, dto: ManualTimeLogDto) {
    const user = await this.prisma.user.findFirst({ where: { id: dto.userId, companyId } });
    if (!user) throw new NotFoundException(`Empleado ${dto.userId} no encontrado`);

    const dayStart = new Date(`${dto.workDate}T00:00:00`);
    const dayEnd = addDays(dayStart, 1);

    // El turno pudo haber quedado guardado previamente cruzando la
    // medianoche (ej. vigilante 10pm-6am); hay que borrar tambien esas
    // marcas para no dejar residuos duplicados, sin tocar el turno del dia
    // siguiente si es uno distinto.
    const existingCheckIn = await this.prisma.timeLog.findFirst({
      where: { userId: dto.userId, logType: TimeLogType.CHECK_IN, loggedAt: { gte: dayStart, lt: dayEnd } },
    });
    let deleteRangeEnd = dayEnd;
    if (existingCheckIn) {
      const searchEnd = addDays(existingCheckIn.loggedAt, 1);
      const nextCheckIn = await this.prisma.timeLog.findFirst({
        where: { userId: dto.userId, logType: TimeLogType.CHECK_IN, loggedAt: { gt: existingCheckIn.loggedAt, lt: searchEnd } },
        orderBy: { loggedAt: 'asc' },
      });
      deleteRangeEnd = nextCheckIn?.loggedAt ?? searchEnd;
    }

    // El turno de AYER (si tambien fue nocturno) puede haber dejado su
    // salida o marcas de almuerzo dentro de la ventana calendario de hoy;
    // no deben borrarse al reemplazar las marcas de hoy.
    const yesterdayMarks = await findShiftMarks(this.prisma, dto.userId, addDays(dayStart, -1));
    let deleteRangeStart = dayStart;
    for (const mark of [yesterdayMarks.lunchOut, yesterdayMarks.lunchIn, yesterdayMarks.checkOut]) {
      if (mark && mark >= deleteRangeStart && mark < dayEnd) {
        deleteRangeStart = new Date(mark.getTime() + 1);
      }
    }

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

    const [novelties, totals] = await Promise.all([
      this.prisma.novelty.findMany({
        where: { userId, workDate: { gte: rangeStart, lt: rangeEnd } },
        orderBy: { workDate: 'asc' },
      }),
      this.prisma.attendanceDailyTotal.findMany({
        where: { userId, workDate: { gte: rangeStart, lt: rangeEnd } },
      }),
    ]);

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
        novelties: noveltiesByDate.get(workDate) ?? [],
        totalOrdinaryHours: total?.totalOrdinaryHours ?? 0,
        totalOvertimeHours: total?.totalOvertimeHours ?? 0,
        totalWorkedHours: total?.totalWorkedHours ?? 0,
      });
    }

    return results;
  }
}
