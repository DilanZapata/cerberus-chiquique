import { Injectable, NotFoundException } from '@nestjs/common';
import {
  calculateDailyNovelties,
  getIsoWeekKey,
  PlannedShiftWindow,
} from '@cerberus/cst-rules';
import {
  DailyCalculationResult,
  LunchPolicy,
  NoveltyCode,
  NoveltyOrigin,
  NoveltyStatus,
  PayrollConfigParams,
} from '@cerberus/shared-types';
import {
  DayOfWeek,
  NoveltyCode as PrismaNoveltyCode,
  NoveltyOrigin as PrismaNoveltyOrigin,
  NoveltyStatus as PrismaNoveltyStatus,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { addDays, combineDateAndTime, startOfLocalDay, timeToHHmm } from '../../common/utils/time.util';
import { findShiftMarks } from '../../common/utils/shift-marks.util';
import { PayrollConfigService } from '../payroll-config/payroll-config.service';

// @cerberus/shared-types define sus propios enums (consumidos tambien por web/mobile,
// que no tienen el cliente de Prisma). Aqui, en el limite con la base de datos,
// se convierten explicitamente a los enums generados por Prisma (mismos valores string).
function toPrismaNoveltyCode(code: NoveltyCode): PrismaNoveltyCode {
  return code as unknown as PrismaNoveltyCode;
}
function toPrismaNoveltyOrigin(origin: NoveltyOrigin): PrismaNoveltyOrigin {
  return origin as unknown as PrismaNoveltyOrigin;
}
function toPrismaNoveltyStatus(status: NoveltyStatus): PrismaNoveltyStatus {
  return status as unknown as PrismaNoveltyStatus;
}

const DAY_OF_WEEK_BY_INDEX: DayOfWeek[] = [
  DayOfWeek.SUNDAY,
  DayOfWeek.MONDAY,
  DayOfWeek.TUESDAY,
  DayOfWeek.WEDNESDAY,
  DayOfWeek.THURSDAY,
  DayOfWeek.FRIDAY,
  DayOfWeek.SATURDAY,
];

const SUNDAY_HOLIDAY_CODES: PrismaNoveltyCode[] = ['DDCOF', 'DNCOF'] as PrismaNoveltyCode[];

interface ShiftResolution {
  plannedShift?: PlannedShiftWindow;
  /** El horario (cargo, individual o rutina) marca este dia como no laboral. */
  isScheduledRestDay: boolean;
}

@Injectable()
export class NoveltiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payrollConfigService: PayrollConfigService,
  ) {}

  /**
   * Calcula las novedades de un dia para un empleado y las persiste. Si el
   * dia esta cubierto por una incidencia APROBADA (permiso/incapacidad),
   * omite el analisis de marcas y persiste directamente esa novedad.
   * Al final, si el dia genero trabajo en domingo/festivo, evalua si ya se
   * volvio "habitual" este mes y genera el credito de descanso compensatorio.
   */
  async calculateAndPersistForDay(userId: string, workDate: string): Promise<DailyCalculationResult> {
    const date = new Date(`${workDate}T00:00:00`);

    const coveringIncidence = await this.prisma.incidence.findFirst({
      where: { userId, status: PrismaNoveltyStatus.APROBADA, startDate: { lte: date }, endDate: { gte: date } },
    });
    if (coveringIncidence) {
      return this.persistIncidenceCoverage(userId, workDate, coveringIncidence);
    }

    const result = await this.computeDayResult(userId, date);
    await this.persist(userId, workDate, result);

    const workedSundayOrHoliday = result.novelties.some(
      (n) => (n.code === NoveltyCode.DDCOF || n.code === NoveltyCode.DNCOF) && n.hours > 0,
    );
    if (workedSundayOrHoliday) {
      const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { companyId: true } });
      const payrollConfig = await this.payrollConfigService.resolveEffective(user.companyId, date);
      await this.handleCompensatoryRest(userId, date, payrollConfig);
    }

    return result;
  }

  /** Recalcula un rango de dias en orden cronologico (ej. tras editar una marca antigua). */
  async recalculateRange(userId: string, from: string, to: string): Promise<DailyCalculationResult[]> {
    const start = new Date(`${from}T00:00:00`);
    const end = new Date(`${to}T00:00:00`);
    const results: DailyCalculationResult[] = [];

    for (let day = start; day <= end; day = addDays(day, 1)) {
      const workDate = day.toISOString().slice(0, 10);
      results.push(await this.calculateAndPersistForDay(userId, workDate));
    }
    return results;
  }

  /** Persiste la novedad correspondiente a una incidencia aprobada que cubre todo el dia, sin analizar marcas. */
  private async persistIncidenceCoverage(
    userId: string,
    workDate: string,
    incidence: { code: PrismaNoveltyCode; hoursPerDay: { toNumber(): number } | null },
  ): Promise<DailyCalculationResult> {
    const date = new Date(`${workDate}T00:00:00`);
    const { plannedShift } = await this.getPlannedShift(userId, date);
    const hours =
      incidence.hoursPerDay?.toNumber() ??
      (plannedShift ? (plannedShift.end.getTime() - plannedShift.start.getTime()) / 3_600_000 : 8);

    await this.prisma.$transaction([
      this.prisma.novelty.deleteMany({ where: { userId, workDate: date } }),
      this.prisma.novelty.create({
        data: {
          userId,
          workDate: date,
          code: incidence.code,
          hours,
          status: PrismaNoveltyStatus.APROBADA,
          origin: PrismaNoveltyOrigin.MANUAL,
          notes: 'Dia cubierto por una incidencia (permiso/incapacidad) aprobada.',
        },
      }),
      this.prisma.attendanceDailyTotal.upsert({
        where: { userId_workDate: { userId, workDate: date } },
        create: { userId, workDate: date, totalOrdinaryHours: 0, totalOvertimeHours: 0, totalWorkedHours: 0 },
        update: { totalOrdinaryHours: 0, totalOvertimeHours: 0, totalWorkedHours: 0 },
      }),
    ]);

    return {
      userId,
      workDate,
      novelties: [
        {
          code: incidence.code as unknown as NoveltyCode,
          hours,
          status: NoveltyStatus.APROBADA,
          origin: NoveltyOrigin.MANUAL,
        },
      ],
      totalOrdinaryHours: 0,
      totalOvertimeHours: 0,
      totalWorkedHours: 0,
      hasPendingOvertime: false,
    };
  }

  /**
   * Si el domingo/festivo trabajado supera `dominicalOcasionalMaxPerMonth`
   * en el mes calendario (Art. 180 CST: 3ra vez en adelante = "habitual"),
   * genera un credito de descanso compensatorio pendiente para ese dia.
   */
  private async handleCompensatoryRest(userId: string, date: Date, payrollConfig: PayrollConfigParams): Promise<void> {
    const monthStart = new Date(date.getFullYear(), date.getMonth(), 1);
    const workedHolidaysThisMonth = await this.prisma.novelty.findMany({
      where: {
        userId,
        workDate: { gte: monthStart, lte: date },
        code: { in: SUNDAY_HOLIDAY_CODES },
        status: { not: PrismaNoveltyStatus.RECHAZADA },
      },
      distinct: ['workDate'],
      select: { workDate: true },
    });

    if (workedHolidaysThisMonth.length <= payrollConfig.dominicalOcasionalMaxPerMonth) return;

    await this.prisma.compensatoryRestCredit.upsert({
      where: { userId_earnedForDate: { userId, earnedForDate: date } },
      create: {
        userId,
        earnedForDate: date,
        notes: `Domingo/festivo habitual (Art. 180 CST): trabajado ${workedHolidaysThisMonth.length} veces este mes.`,
      },
      update: {},
    });
  }

  /** Calcula el resultado del dia SIN persistir (usado tambien para reconstruir el acumulado semanal). */
  private async computeDayResult(userId: string, date: Date): Promise<DailyCalculationResult> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, companyId: true, allowsLunchSkip: true },
    });
    if (!user) throw new NotFoundException(`Usuario ${userId} no encontrado`);

    const [payrollConfig, lunchPolicy, shiftResolution, marks, weekOrdinaryMinutesAccumulated, weekOvertimeMinutesAccumulated] =
      await Promise.all([
        this.payrollConfigService.resolveEffective(user.companyId, date),
        this.getLunchPolicy(userId, date, user.allowsLunchSkip),
        this.getPlannedShift(userId, date),
        this.getDayMarks(userId, date),
        this.getWeekAccumulated(userId, date, 'totalOrdinaryHours'),
        this.getWeekAccumulated(userId, date, 'totalOvertimeHours'),
      ]);

    return calculateDailyNovelties({
      userId,
      workDate: date.toISOString().slice(0, 10),
      marks,
      lunchPolicy,
      payrollConfig,
      plannedShift: shiftResolution.plannedShift,
      isScheduledRestDay: shiftResolution.isScheduledRestDay,
      weekOrdinaryMinutesAccumulated,
      weekOvertimeMinutesAccumulated,
    });
  }

  /** Suma en minutos, para la semana ISO en curso (antes de `date`), el campo indicado del resultado diario. */
  private async getWeekAccumulated(
    userId: string,
    date: Date,
    field: 'totalOrdinaryHours' | 'totalOvertimeHours',
  ): Promise<number> {
    const weekKey = getIsoWeekKey(date);
    const monday = addDays(date, -((date.getDay() + 6) % 7));

    let accumulatedMinutes = 0;
    for (let day = monday; day < startOfLocalDay(date); day = addDays(day, 1)) {
      if (getIsoWeekKey(day) !== weekKey) continue;
      const hasMarks = await this.prisma.timeLog.count({
        where: { userId, loggedAt: { gte: day, lt: addDays(day, 1) } },
      });
      if (!hasMarks) continue;

      const dayResult = await this.computeDayResult(userId, day);
      accumulatedMinutes += dayResult[field] * 60;
    }
    return accumulatedMinutes;
  }

  private toLunchPolicy(
    schedule: { defaultLunchMinutes: number; lunchWindowStart: Date; lunchWindowEnd: Date; lunchToleranceMinutes: number },
    allowsLunchSkip: boolean,
  ): LunchPolicy {
    return {
      defaultLunchMinutes: schedule.defaultLunchMinutes,
      windowStart: timeToHHmm(schedule.lunchWindowStart),
      windowEnd: timeToHHmm(schedule.lunchWindowEnd),
      toleranceMinutes: schedule.lunchToleranceMinutes,
      allowsLunchSkip,
    };
  }

  /** Mismo orden de resolucion que `getPlannedShift`: horario individual (UserSchedule) antes que el del cargo. */
  private async getLunchPolicy(userId: string, date: Date, allowsLunchSkip: boolean): Promise<LunchPolicy> {
    const userSchedule = await this.prisma.userSchedule.findFirst({
      where: {
        userId,
        validFrom: { lte: date },
        OR: [{ validTo: null }, { validTo: { gte: date } }],
      },
      orderBy: { validFrom: 'desc' },
      include: { schedule: true },
    });
    if (userSchedule) {
      return this.toLunchPolicy(userSchedule.schedule, allowsLunchSkip);
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { position: { include: { schedule: true } } },
    });
    if (user?.position?.schedule) {
      return this.toLunchPolicy(user.position.schedule, allowsLunchSkip);
    }

    // Sin horario asignado (ni individual ni por cargo): valores por defecto conservadores.
    return {
      defaultLunchMinutes: 60,
      windowStart: '12:00',
      windowEnd: '14:00',
      toleranceMinutes: 10,
      allowsLunchSkip,
    };
  }

  /**
   * Resuelve el horario planeado (crudo, sin ajustar por almuerzo) a partir
   * de un Schedule ya cargado con sus ScheduleDetail. El ajuste por omision
   * de almuerzo depende de las marcas de CADA dia (si ese dia realmente paso
   * derecho o no), no solo del permiso del empleado, asi que se resuelve mas
   * adelante en el motor de calculo (`calculateDailyNovelties`), que si
   * conoce las marcas del dia.
   *
   * Distingue "el dia no existe en el horario" (anomalia, se trata como sin
   * horario) de "el dia SI existe pero es de descanso" (isScheduledRestDay),
   * que es la que le importa a `calculateDailyNovelties` para saber que ese
   * dia no tiene cupo ordinario propio.
   */
  private resolveShiftFromSchedule(
    schedule: { details: { dayOfWeek: DayOfWeek; isWorkingDay: boolean; startTime: Date | null; endTime: Date | null }[] },
    date: Date,
  ): ShiftResolution {
    const dayOfWeek = DAY_OF_WEEK_BY_INDEX[date.getDay()];
    const detail = schedule.details.find((d) => d.dayOfWeek === dayOfWeek);
    if (!detail) return { plannedShift: undefined, isScheduledRestDay: false };
    if (!detail.isWorkingDay || !detail.startTime || !detail.endTime) {
      return { plannedShift: undefined, isScheduledRestDay: true };
    }

    return {
      plannedShift: {
        start: combineDateAndTime(date, detail.startTime),
        end: combineDateAndTime(date, detail.endTime),
      },
      isScheduledRestDay: false,
    };
  }

  /**
   * Orden de resolucion del horario planeado de un dia:
   *  1. Turno generado por rutinas rotativas (Shift), si existe.
   *  2. Horario asignado directamente al empleado (UserSchedule) - anula el del cargo.
   *  3. Horario del cargo asignado al empleado (Position.schedule) - el caso comun.
   */
  private async getPlannedShift(userId: string, date: Date): Promise<ShiftResolution> {
    const shift = await this.prisma.shift.findUnique({
      where: { userId_workDate: { userId, workDate: date } },
    });
    if (shift) {
      if (shift.isRestDay) return { plannedShift: undefined, isScheduledRestDay: true };
      return { plannedShift: { start: shift.plannedStart, end: shift.plannedEnd }, isScheduledRestDay: false };
    }

    const userSchedule = await this.prisma.userSchedule.findFirst({
      where: {
        userId,
        validFrom: { lte: date },
        OR: [{ validTo: null }, { validTo: { gte: date } }],
      },
      orderBy: { validFrom: 'desc' },
      include: {
        schedule: { include: { details: true } },
      },
    });
    if (userSchedule) {
      return this.resolveShiftFromSchedule(userSchedule.schedule, date);
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { position: { include: { schedule: { include: { details: true } } } } },
    });
    if (!user?.position?.schedule) return { plannedShift: undefined, isScheduledRestDay: false };

    return this.resolveShiftFromSchedule(user.position.schedule, date);
  }

  /**
   * Empaqueta, para el instante `now`, todo lo que la interpretacion de una
   * marca de kiosco/app movil necesita del horario del empleado: su turno
   * planeado de hoy y de ayer (misma resolucion Shift > UserSchedule >
   * Position.schedule que usa el calculo de novedades, para que la
   * INTERPRETACION de la marca y el CALCULO de nomina nunca queden
   * desincronizados), y su politica de almuerzo (para el caso de
   * adelanto/compensacion). Usado por `resolveNextMark` en
   * shift-marks.util.ts.
   */
  async resolveMarkContext(userId: string, now: Date) {
    const today = startOfLocalDay(now);
    const yesterday = addDays(today, -1);

    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const [todayShift, yesterdayShift, lunchPolicy] = await Promise.all([
      this.getPlannedShift(userId, today),
      this.getPlannedShift(userId, yesterday),
      this.getLunchPolicy(userId, today, user.allowsLunchSkip),
    ]);

    return {
      todayPlannedShift: todayShift.plannedShift,
      yesterdayPlannedShift: yesterdayShift.plannedShift,
      allowsLunchSkip: user.allowsLunchSkip,
      defaultLunchMinutes: lunchPolicy.defaultLunchMinutes,
    };
  }

  /**
   * Busca las marcas del turno que inicia en `date`. Usa la utilidad
   * compartida que reconoce turnos nocturnos (ej. vigilantes 10pm-6am): la
   * salida se busca en orden cronologico, no restringida al mismo dia
   * calendario de la entrada.
   */
  private async getDayMarks(userId: string, date: Date) {
    return findShiftMarks(this.prisma, userId, date);
  }

  private async persist(userId: string, workDate: string, result: DailyCalculationResult): Promise<void> {
    const date = new Date(`${workDate}T00:00:00`);

    await this.prisma.$transaction([
      this.prisma.novelty.deleteMany({
        where: { userId, workDate: date, origin: toPrismaNoveltyOrigin(NoveltyOrigin.SISTEMA) },
      }),
      ...result.novelties.map((novelty) =>
        this.prisma.novelty.create({
          data: {
            userId,
            workDate: date,
            code: toPrismaNoveltyCode(novelty.code),
            hours: novelty.hours,
            status: toPrismaNoveltyStatus(novelty.status),
            origin: toPrismaNoveltyOrigin(novelty.origin),
            notes: novelty.notes,
          },
        }),
      ),
      // Totales del dia, usados por el reporte de nomina (incluyen horas
      // ordinarias sin recargo, que no se guardan como novedad individual).
      this.prisma.attendanceDailyTotal.upsert({
        where: { userId_workDate: { userId, workDate: date } },
        create: {
          userId,
          workDate: date,
          totalOrdinaryHours: result.totalOrdinaryHours,
          totalOvertimeHours: result.totalOvertimeHours,
          totalWorkedHours: result.totalWorkedHours,
        },
        update: {
          totalOrdinaryHours: result.totalOrdinaryHours,
          totalOvertimeHours: result.totalOvertimeHours,
          totalWorkedHours: result.totalWorkedHours,
        },
      }),
    ]);

    const pendingOvertime = result.novelties.find((n) => n.code === NoveltyCode.HORA_EXTRA_PENDIENTE);
    if (pendingOvertime && pendingOvertime.status === NoveltyStatus.PENDIENTE) {
      const created = await this.prisma.novelty.findFirst({
        where: { userId, workDate: date, code: toPrismaNoveltyCode(NoveltyCode.HORA_EXTRA_PENDIENTE) },
      });
      if (created) {
        await this.prisma.overtimeApproval.create({
          data: {
            noveltyId: created.id,
            requestedHours: pendingOvertime.hours,
            status: toPrismaNoveltyStatus(NoveltyStatus.PENDIENTE),
          },
        });
      }
    }
  }
}
