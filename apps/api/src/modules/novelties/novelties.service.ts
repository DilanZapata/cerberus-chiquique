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
  CycleWeek,
  DayOfWeek,
  NoveltyCode as PrismaNoveltyCode,
  NoveltyOrigin as PrismaNoveltyOrigin,
  NoveltyStatus as PrismaNoveltyStatus,
  ScheduleType,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { addDays, combineDateAndTime, startOfLocalDay, timeToHHmm } from '../../common/utils/time.util';
import { findShiftMarks } from '../../common/utils/shift-marks.util';
import { resolveActiveCycleWeek } from '../../common/utils/rotating-schedule.util';
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

export interface ShiftResolution {
  plannedShift?: PlannedShiftWindow;
  /** El horario (cargo, individual o rutina) marca este dia como no laboral. */
  isScheduledRestDay: boolean;
  /**
   * Ventanas configurables del Schedule resuelto (Fase 4). Undefined cuando
   * el turno viene de una rutina rotativa (Shift) o no hay horario asignado
   * -- en esos casos el llamador debe aplicar sus propios defaults, ya que
   * un Shift generado por rutina no tiene un Schedule propio del cual leer
   * estos valores.
   */
  finalExitWindowBeforeMin?: number;
  finalExitGraceMin?: number;
}

/**
 * Resultado de `getScheduleInfoForDate` -- la funcion central que resuelve
 * "que horario le corresponde a este empleado en esta fecha", pensada para
 * consumo de UI (vista previa del ciclo al configurar un horario rotativo) y
 * depuracion, no para el motor de calculo (que sigue usando `getPlannedShift`/
 * `getLunchPolicy` directamente).
 */
export interface ScheduleInfoForDate {
  hasSchedule: boolean;
  source: 'SHIFT' | 'SCHEDULE' | 'NONE';
  scheduleName: string | null;
  scheduleType: ScheduleType | null;
  /** Solo definido cuando scheduleType es BIWEEKLY_ROTATING. */
  activeWeek: CycleWeek | null;
  isScheduledRestDay: boolean;
  plannedShift: PlannedShiftWindow | null;
}

type ScheduleWithDetails = {
  name: string;
  scheduleType: ScheduleType;
  details: { week: CycleWeek; dayOfWeek: DayOfWeek; isWorkingDay: boolean; startTime: Date | null; endTime: Date | null }[];
  finalExitWindowBeforeMin: number;
  finalExitGraceMin: number;
  defaultLunchMinutes: number;
  lunchWindowStart: Date;
  lunchWindowEnd: Date;
  lunchToleranceMinutes: number;
};

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

  /**
   * La ventana/tolerancia de almuerzo vive a nivel de cabecera del Schedule
   * (no varia entre semana A y B de un horario rotativo -- el ScheduleDetail
   * por dia trae su propio `lunchMinutes` en el schema, pero ese campo no lo
   * consume ningun modulo, ni antes ni despues de esta funcionalidad).
   */
  private async getLunchPolicy(userId: string, date: Date, allowsLunchSkip: boolean): Promise<LunchPolicy> {
    const resolved = await this.resolveAssignedSchedule(userId, date);
    if (resolved) return this.toLunchPolicy(resolved.schedule, allowsLunchSkip);

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
   * Punto UNICO de resolucion de "que Schedule (y que semana del ciclo, si es
   * rotativo) le corresponde a este empleado en esta fecha", compartido por
   * `getPlannedShift` y `getLunchPolicy` (antes hacian esta misma busqueda
   * UserSchedule->Position por separado). Orden de precedencia:
   *  1. Horario asignado directamente al empleado (UserSchedule) - anula el del cargo.
   *  2. Horario del cargo asignado al empleado (Position.schedule) - el caso comun.
   * No incluye el paso previo de `Shift` materializado (rutinas rotativas
   * tipo ShiftPattern): ese siempre gana antes de llegar aqui, ver
   * `getPlannedShift`.
   */
  private async resolveAssignedSchedule(
    userId: string,
    date: Date,
  ): Promise<{ schedule: ScheduleWithDetails; activeWeek: CycleWeek } | null> {
    const userSchedule = await this.prisma.userSchedule.findFirst({
      where: {
        userId,
        validFrom: { lte: date },
        OR: [{ validTo: null }, { validTo: { gte: date } }],
      },
      orderBy: { validFrom: 'desc' },
      include: { schedule: { include: { details: true } } },
    });
    if (userSchedule) {
      return {
        schedule: userSchedule.schedule,
        activeWeek: this.resolveWeekFor(
          userSchedule.schedule.scheduleType,
          userSchedule.cycleAnchorDate,
          userSchedule.cycleStartWeek,
          date,
        ),
      };
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { position: { include: { schedule: { include: { details: true } } } } },
    });
    if (!user?.position?.schedule) return null;

    // Un Schedule BIWEEKLY_ROTATING nunca puede asignarse a un Position
    // (validado en CompaniesService.createPosition/updatePosition/updateSchedule,
    // el ancla del ciclo es individual y Position es compartido) -- por eso
    // aqui siempre es WEEKLY, semana A implicita.
    return { schedule: user.position.schedule, activeWeek: CycleWeek.A };
  }

  /**
   * Calcula la semana activa (A o B) para un horario rotativo, con un default
   * explicito a A en un solo lugar -- para que ningun llamador futuro tenga
   * que recordar el `?? 'A'` de un horario WEEKLY por su cuenta.
   */
  private resolveWeekFor(
    scheduleType: ScheduleType,
    cycleAnchorDate: Date | null,
    cycleStartWeek: CycleWeek | null,
    date: Date,
  ): CycleWeek {
    if (scheduleType !== ScheduleType.BIWEEKLY_ROTATING) return CycleWeek.A;
    // Ancla incompleta (no deberia ocurrir, se valida al asignar el horario):
    // degradar a semana A en vez de romper la resolucion del turno del dia.
    if (!cycleAnchorDate || !cycleStartWeek) return CycleWeek.A;
    return resolveActiveCycleWeek(cycleAnchorDate, cycleStartWeek, date);
  }

  /**
   * Resuelve el horario planeado (crudo, sin ajustar por almuerzo) a partir
   * de un Schedule ya cargado con sus ScheduleDetail, para la semana del
   * ciclo que le corresponde a `date` (`activeWeek`, siempre A para un
   * Schedule WEEKLY). El ajuste por omision de almuerzo depende de las
   * marcas de CADA dia (si ese dia realmente paso derecho o no), no solo del
   * permiso del empleado, asi que se resuelve mas adelante en el motor de
   * calculo (`calculateDailyNovelties`), que si conoce las marcas del dia.
   *
   * Distingue "el dia no existe en el horario" (anomalia, se trata como sin
   * horario) de "el dia SI existe pero es de descanso" (isScheduledRestDay),
   * que es la que le importa a `calculateDailyNovelties` para saber que ese
   * dia no tiene cupo ordinario propio.
   */
  private resolveShiftFromSchedule(schedule: ScheduleWithDetails, activeWeek: CycleWeek, date: Date): ShiftResolution {
    const dayOfWeek = DAY_OF_WEEK_BY_INDEX[date.getDay()];
    const detail = schedule.details.find((d) => d.week === activeWeek && d.dayOfWeek === dayOfWeek);
    if (!detail) return { plannedShift: undefined, isScheduledRestDay: false };
    if (!detail.isWorkingDay || !detail.startTime || !detail.endTime) {
      return { plannedShift: undefined, isScheduledRestDay: true };
    }

    const start = combineDateAndTime(date, detail.startTime);
    let end = combineDateAndTime(date, detail.endTime);
    // Turno que cruza medianoche (ej. vigilante 22:00-06:00): la hora de
    // salida en reloj es "menor" que la de entrada, asi que el instante real
    // de salida cae en el dia calendario SIGUIENTE, no en el mismo `date`.
    // Sin este ajuste, `end` quedaba apuntando a una hora del pasado (ej.
    // 06:00 del MISMO dia que 22:00), rompiendo el calculo de la ventana de
    // gracia para continuar el turno nocturno al cruzar medianoche.
    if (end <= start) end = addDays(end, 1);

    return {
      plannedShift: { start, end },
      isScheduledRestDay: false,
      finalExitWindowBeforeMin: schedule.finalExitWindowBeforeMin,
      finalExitGraceMin: schedule.finalExitGraceMin,
    };
  }

  /**
   * Orden de resolucion del horario planeado de un dia:
   *  1. Turno generado por rutinas rotativas (Shift), si existe. NOTA: si un
   *     empleado tuviera a la vez una UserShiftPatternAssignment activa y un
   *     UserSchedule rotativo activo (configuracion inconsistente, no deberia
   *     ocurrir en uso normal), el Shift materializado gana silenciosamente
   *     -- mismo comportamiento que ya existia para horarios WEEKLY antes de
   *     esta funcionalidad, documentado aqui porque ahora aplica tambien a
   *     horarios rotativos.
   *  2. Horario asignado directamente al empleado (UserSchedule) - anula el del cargo.
   *  3. Horario del cargo asignado al empleado (Position.schedule) - el caso comun.
   */
  /** Publico: reutilizado por resolveMarkContext y por el cierre automatico de jornadas (jornada-cierre.service.ts). */
  async getPlannedShift(userId: string, date: Date): Promise<ShiftResolution> {
    const shift = await this.prisma.shift.findUnique({
      where: { userId_workDate: { userId, workDate: date } },
    });
    if (shift) {
      if (shift.isRestDay) return { plannedShift: undefined, isScheduledRestDay: true };
      return { plannedShift: { start: shift.plannedStart, end: shift.plannedEnd }, isScheduledRestDay: false };
    }

    const resolved = await this.resolveAssignedSchedule(userId, date);
    if (!resolved) return { plannedShift: undefined, isScheduledRestDay: false };

    return this.resolveShiftFromSchedule(resolved.schedule, resolved.activeWeek, date);
  }

  /**
   * `obtenerHorarioEmpleadoParaFecha`: la funcion central, para consumo
   * externo (UI/depuracion), que devuelve toda la informacion resuelta del
   * horario de un empleado en una fecha dada -- incluida la semana del ciclo
   * (A/B) cuando aplica. El motor de calculo sigue usando `getPlannedShift`/
   * `getLunchPolicy` directamente (mismos datos, forma mas liviana); esta
   * funcion existe para que otros consumidores (ej. una vista previa del
   * ciclo al configurar un horario rotativo) nunca tengan que reimplementar
   * la logica de resolucion por su cuenta.
   */
  async getScheduleInfoForDate(userId: string, date: Date): Promise<ScheduleInfoForDate> {
    const shift = await this.prisma.shift.findUnique({
      where: { userId_workDate: { userId, workDate: date } },
    });
    if (shift) {
      return {
        hasSchedule: true,
        source: 'SHIFT',
        scheduleName: null,
        scheduleType: null,
        activeWeek: null,
        isScheduledRestDay: shift.isRestDay,
        plannedShift: shift.isRestDay ? null : { start: shift.plannedStart, end: shift.plannedEnd },
      };
    }

    const resolved = await this.resolveAssignedSchedule(userId, date);
    if (!resolved) {
      return {
        hasSchedule: false,
        source: 'NONE',
        scheduleName: null,
        scheduleType: null,
        activeWeek: null,
        isScheduledRestDay: false,
        plannedShift: null,
      };
    }

    const resolution = this.resolveShiftFromSchedule(resolved.schedule, resolved.activeWeek, date);
    return {
      hasSchedule: true,
      source: 'SCHEDULE',
      scheduleName: resolved.schedule.name,
      scheduleType: resolved.schedule.scheduleType,
      activeWeek: resolved.schedule.scheduleType === ScheduleType.BIWEEKLY_ROTATING ? resolved.activeWeek : null,
      isScheduledRestDay: resolution.isScheduledRestDay,
      plannedShift: resolution.plannedShift ?? null,
    };
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
      // Preferimos las ventanas del horario de hoy; si hoy no tiene Schedule
      // resuelto (ej. turno de rutina rotativa) usamos las de ayer para no
      // perder la configuracion en el caso de continuar un turno nocturno.
      // Si ninguno tiene, resolveNextMark aplica sus propios defaults.
      finalExitWindowBeforeMin: todayShift.finalExitWindowBeforeMin ?? yesterdayShift.finalExitWindowBeforeMin,
      finalExitGraceMin: todayShift.finalExitGraceMin ?? yesterdayShift.finalExitGraceMin,
      // Misma ventana de almuerzo (hora y tolerancia) que ya usa el motor de
      // nomina (resolveLunch en cst-rules) para decidir si un hueco sin
      // marcar es almuerzo o no -- resolveNextMark la usa para lo mismo: no
      // confundir una marca fuera de esta ventana con "salida a almuerzo".
      lunchWindowStart: lunchPolicy.windowStart,
      lunchWindowEnd: lunchPolicy.windowEnd,
      lunchToleranceMinutes: lunchPolicy.toleranceMinutes,
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
