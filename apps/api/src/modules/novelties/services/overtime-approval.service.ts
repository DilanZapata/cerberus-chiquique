import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { NoveltyStatus as PrismaNoveltyStatus, NoveltyCode as PrismaNoveltyCode, UserRole } from '@prisma/client';
import { NoveltyStatus } from '@cerberus/shared-types';
import { PrismaService } from '../../../database/prisma.service';
import { AuthenticatedUser } from '../../../common/decorators/current-user.decorator';
import { NoveltiesService } from '../novelties.service';
import { ReviewNoveltyDto } from '../dto/review-novelty.dto';
import { AuthorizeOvertimeDto } from '../dto/authorize-overtime.dto';

const OVERTIME_DETAIL_CODES: PrismaNoveltyCode[] = ['HEOD', 'HEON', 'HEFD', 'HEFN'] as PrismaNoveltyCode[];
const MAX_RANGE_DAYS = 62;

function isHalfHourStep(hours: number): boolean {
  return Math.abs(hours * 2 - Math.round(hours * 2)) < 1e-9;
}

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Horas extra: quien puede autorizarlas, la autorizacion por persona y dia
 * (antes o despues de trabajarlas) y la decision sobre lo pendiente.
 *
 * Toda decision se guarda en `OvertimeAuthorization` (una fila por persona
 * y dia) y luego se RECALCULA el dia: el calculo de nomina es el que parte
 * las horas extra en aprobadas / pendientes / rechazadas segun esa fila
 * (ver `applyOvertimeAuthorization` en cst-rules). Asi la decision no vive
 * en las novedades (que se borran y recrean en cada recalculo) sino en un
 * registro propio, con su rastro en `AuditLog`.
 */
@Injectable()
export class OvertimeApprovalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly noveltiesService: NoveltiesService,
  ) {}

  /** Roles que la empresa habilito para autorizar horas extra. ADMIN siempre puede (evita quedarse sin nadie que autorice). */
  async getApproverRoles(companyId: string): Promise<UserRole[]> {
    const settings = await this.prisma.payrollSettings.findUnique({
      where: { companyId },
      select: { overtimeApproverRoles: true },
    });
    const roles = settings?.overtimeApproverRoles ?? [UserRole.ADMIN, UserRole.HR, UserRole.SUPERVISOR];
    return roles.includes(UserRole.ADMIN) ? roles : [UserRole.ADMIN, ...roles];
  }

  async getPermissions(actor: AuthenticatedUser) {
    const approverRoles = await this.getApproverRoles(actor.companyId);
    return { canApprove: approverRoles.includes(actor.role as UserRole), role: actor.role, approverRoles };
  }

  private async assertCanApprove(actor: AuthenticatedUser): Promise<void> {
    const { canApprove } = await this.getPermissions(actor);
    if (!canApprove) {
      throw new ForbiddenException('Tu rol no esta habilitado para autorizar horas extra en esta empresa.');
    }
  }

  /** Horas extra trabajadas / aprobadas / pendientes / rechazadas de una persona en un dia, segun lo ya calculado. */
  private async overtimeBreakdown(userId: string, workDate: Date) {
    const rows = await this.prisma.novelty.findMany({
      where: { userId, workDate, code: { in: OVERTIME_DETAIL_CODES } },
      select: { hours: true, status: true },
    });
    const sum = (filter: (status: PrismaNoveltyStatus) => boolean) =>
      Math.round(rows.filter((r) => filter(r.status)).reduce((total, r) => total + r.hours.toNumber(), 0) * 1000) / 1000;
    return {
      workedHours: sum(() => true),
      // AUTO_CALCULADA = empresa que no exige autorizacion: tambien se paga.
      approvedHours: sum((s) => s === PrismaNoveltyStatus.APROBADA || s === PrismaNoveltyStatus.AUTO_CALCULADA),
      pendingHours: sum((s) => s === PrismaNoveltyStatus.PENDIENTE),
      rejectedHours: sum((s) => s === PrismaNoveltyStatus.RECHAZADA),
    };
  }

  /** Recalcula el dia solo si ya tenia calculo (una autorizacion para un dia futuro no debe "cerrarlo"). */
  private async recalculateIfComputed(userId: string, workDate: Date): Promise<void> {
    const computed = await this.prisma.attendanceDailyTotal.findUnique({
      where: { userId_workDate: { userId, workDate } },
      select: { id: true },
    });
    if (computed) await this.noveltiesService.calculateAndPersistForDay(userId, dateKey(workDate));
  }

  /** Solicitudes de horas extra pendientes de decidir, con lo que ya se habia autorizado ese dia. */
  async listPending(actor: AuthenticatedUser, departmentId?: string) {
    await this.assertCanApprove(actor);
    const approvals = await this.prisma.overtimeApproval.findMany({
      where: {
        status: PrismaNoveltyStatus.PENDIENTE,
        novelty: { user: { companyId: actor.companyId, ...(departmentId ? { departmentId } : {}) } },
      },
      include: {
        novelty: {
          include: {
            user: {
              select: { id: true, fullName: true, employeeCode: true, departmentId: true, department: { select: { name: true } } },
            },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    const authorizations = await this.prisma.overtimeAuthorization.findMany({
      where: { OR: approvals.map((a) => ({ userId: a.novelty.userId, workDate: a.novelty.workDate })) },
      include: { authorizedBy: { select: { fullName: true } } },
    });
    const authByKey = new Map(authorizations.map((a) => [`${a.userId}|${dateKey(a.workDate)}`, a]));

    return Promise.all(
      approvals.map(async (approval) => {
        const authorization = authByKey.get(`${approval.novelty.userId}|${dateKey(approval.novelty.workDate)}`);
        const breakdown = await this.overtimeBreakdown(approval.novelty.userId, approval.novelty.workDate);
        return {
          ...approval,
          // Contexto para decidir: cuanto se habia autorizado, cuanto trabajo, cuanto falta.
          authorizedHours: authorization?.authorizedHours.toNumber() ?? 0,
          authorizedByName: authorization?.authorizedBy?.fullName ?? null,
          workedHours: breakdown.workedHours,
          pendingHours: breakdown.pendingHours,
        };
      }),
    );
  }

  /**
   * Autoriza N horas extra a una persona para un dia (antes o despues de
   * trabajarlas). Reemplaza la autorizacion anterior de ese dia: es "el
   * total autorizado", no un incremento.
   */
  async authorize(actor: AuthenticatedUser, dto: AuthorizeOvertimeDto) {
    await this.assertCanApprove(actor);
    if (!isHalfHourStep(dto.hours)) {
      throw new BadRequestException('Las horas se autorizan en pasos de media hora (0.5, 1, 1.5...).');
    }
    const employee = await this.prisma.user.findFirst({
      where: { id: dto.userId, companyId: actor.companyId },
      select: { id: true, fullName: true, employeeCode: true },
    });
    if (!employee) throw new NotFoundException('Empleado no encontrado en tu empresa.');

    const workDate = new Date(`${dto.workDate.slice(0, 10)}T00:00:00`);
    const previous = await this.prisma.overtimeAuthorization.findUnique({
      where: { userId_workDate: { userId: employee.id, workDate } },
    });

    const authorization = await this.prisma.overtimeAuthorization.upsert({
      where: { userId_workDate: { userId: employee.id, workDate } },
      create: { userId: employee.id, workDate, authorizedHours: dto.hours, authorizedById: actor.id, notes: dto.notes },
      // Una autorizacion nueva reabre lo que exceda (deja de estar rechazado).
      update: { authorizedHours: dto.hours, excessRejected: false, authorizedById: actor.id, notes: dto.notes },
    });
    await this.prisma.auditLog.create({
      data: {
        companyId: actor.companyId,
        userId: employee.id,
        entity: 'OvertimeAuthorization',
        entityId: authorization.id,
        action: 'AUTHORIZE',
        diff: {
          actingUserId: actor.id,
          workDate: dto.workDate.slice(0, 10),
          previousAuthorizedHours: previous?.authorizedHours.toNumber() ?? null,
          authorizedHours: dto.hours,
          notes: dto.notes ?? null,
        },
      },
    });

    await this.recalculateIfComputed(employee.id, workDate);
    return this.describe(employee.id, workDate);
  }

  /**
   * Decide sobre horas extra pendientes (trabajadas sin autorizacion, o por
   * encima de lo autorizado). APROBADA suma esas horas a la autorizacion del
   * dia (todas, o solo `approvedHours`: el resto sigue pendiente); RECHAZADA
   * marca el excedente como rechazado (queda documentado, no se paga).
   */
  async review(overtimeApprovalId: string, dto: ReviewNoveltyDto, actor: AuthenticatedUser) {
    await this.assertCanApprove(actor);
    const approval = await this.prisma.overtimeApproval.findFirst({
      where: { id: overtimeApprovalId, novelty: { user: { companyId: actor.companyId } } },
      include: { novelty: true },
    });
    if (!approval) {
      throw new NotFoundException(`Solicitud de hora extra ${overtimeApprovalId} no encontrada`);
    }
    if (approval.status !== PrismaNoveltyStatus.PENDIENTE) {
      throw new BadRequestException('Esta solicitud ya fue decidida.');
    }

    const userId = approval.novelty.userId;
    const workDate = approval.novelty.workDate;
    const pendingHours = approval.requestedHours.toNumber();
    const previous = await this.prisma.overtimeAuthorization.findUnique({ where: { userId_workDate: { userId, workDate } } });
    const previousAuthorized = previous?.authorizedHours.toNumber() ?? 0;

    let authorizedHours = previousAuthorized;
    let excessRejected = false;
    // Lo que seguira pendiente tras esta decision. Se anota como "ya avisado":
    // quien decide ya lo esta viendo, no hace falta mandarle un correo por eso.
    let remainingPending = 0;
    if (dto.status === NoveltyStatus.APROBADA) {
      const hours = dto.approvedHours ?? pendingHours;
      if (hours <= 0 || hours > pendingHours || !isHalfHourStep(hours)) {
        throw new BadRequestException(`Puedes aprobar entre 0.5 y ${pendingHours} horas, en pasos de media hora.`);
      }
      // Hay horas pendientes solo cuando lo trabajado supera lo autorizado, asi
      // que lo ya cubierto equivale a lo autorizado: aprobar suma sobre eso.
      const breakdown = await this.overtimeBreakdown(userId, workDate);
      authorizedHours = breakdown.approvedHours + hours;
      remainingPending = Math.max(0, pendingHours - hours);
    } else {
      excessRejected = true;
    }

    const authorization = await this.prisma.overtimeAuthorization.upsert({
      where: { userId_workDate: { userId, workDate } },
      create: {
        userId,
        workDate,
        authorizedHours,
        excessRejected,
        authorizedById: actor.id,
        notes: dto.notes,
        excessNotifiedHours: remainingPending,
      },
      update: {
        authorizedHours,
        excessRejected,
        authorizedById: actor.id,
        notes: dto.notes ?? previous?.notes,
        excessNotifiedHours: remainingPending,
      },
    });
    await this.prisma.auditLog.create({
      data: {
        companyId: actor.companyId,
        userId,
        entity: 'OvertimeAuthorization',
        entityId: authorization.id,
        action: dto.status === NoveltyStatus.APROBADA ? 'APPROVE_PENDING' : 'REJECT_PENDING',
        diff: {
          actingUserId: actor.id,
          workDate: dateKey(workDate),
          pendingHours,
          previousAuthorizedHours: previousAuthorized,
          authorizedHours,
          excessRejected,
          notes: dto.notes ?? null,
        },
      },
    });

    await this.noveltiesService.calculateAndPersistForDay(userId, dateKey(workDate));
    return this.describe(userId, workDate);
  }

  private async describe(userId: string, workDate: Date) {
    const [authorization, breakdown, employee] = await Promise.all([
      this.prisma.overtimeAuthorization.findUnique({
        where: { userId_workDate: { userId, workDate } },
        include: { authorizedBy: { select: { fullName: true } } },
      }),
      this.overtimeBreakdown(userId, workDate),
      this.prisma.user.findUnique({ where: { id: userId }, select: { fullName: true, employeeCode: true } }),
    ]);
    return {
      userId,
      fullName: employee?.fullName ?? '',
      employeeCode: employee?.employeeCode ?? '',
      workDate: dateKey(workDate),
      authorizedHours: authorization?.authorizedHours.toNumber() ?? 0,
      excessRejected: authorization?.excessRejected ?? false,
      authorizedByName: authorization?.authorizedBy?.fullName ?? null,
      notes: authorization?.notes ?? null,
      updatedAt: authorization?.updatedAt ?? null,
      ...breakdown,
    };
  }

  /**
   * Horas extra de UNA persona, dia por dia, en un rango: trabajadas,
   * autorizadas, pendientes y rechazadas, con el motivo de la autorizacion.
   * Solo trae los dias que tienen horas extra o una autorizacion. Es de
   * consulta (no exige poder autorizar): la usa el asistente de la app.
   */
  async listEmployeeOvertime(companyId: string, userId: string, from: string, to: string) {
    const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v ?? '') && !Number.isNaN(Date.parse(`${v}T00:00:00`));
    if (!isDate(from) || !isDate(to)) throw new BadRequestException('"from" y "to" deben ser fechas validas (YYYY-MM-DD).');
    const fromDate = new Date(`${from}T00:00:00`);
    const toDate = new Date(`${to}T00:00:00`);
    if (toDate < fromDate || (toDate.getTime() - fromDate.getTime()) / 86_400_000 > MAX_RANGE_DAYS) {
      throw new BadRequestException(`El rango debe ser valido y de maximo ${MAX_RANGE_DAYS} dias.`);
    }
    const employee = await this.prisma.user.findFirst({ where: { id: userId, companyId }, select: { id: true } });
    if (!employee) throw new NotFoundException('Empleado no encontrado en tu empresa.');

    const [novelties, authorizations] = await Promise.all([
      this.prisma.novelty.findMany({
        where: { userId, workDate: { gte: fromDate, lte: toDate }, code: { in: OVERTIME_DETAIL_CODES } },
        select: { workDate: true },
        distinct: ['workDate'],
      }),
      this.prisma.overtimeAuthorization.findMany({ where: { userId, workDate: { gte: fromDate, lte: toDate } }, select: { workDate: true } }),
    ]);
    const days = [...new Set([...novelties, ...authorizations].map((row) => dateKey(row.workDate)))].sort();
    const rows = [];
    for (const day of days) rows.push(await this.describe(userId, new Date(`${day}T00:00:00`)));
    return rows;
  }

  /** Estado de las horas extra de una persona en un dia puntual (para armar una propuesta de autorizacion). */
  async describeDay(companyId: string, userId: string, workDate: string) {
    const employee = await this.prisma.user.findFirst({ where: { id: userId, companyId }, select: { id: true } });
    if (!employee) throw new NotFoundException('Empleado no encontrado en tu empresa.');
    return this.describe(userId, new Date(`${workDate.slice(0, 10)}T00:00:00`));
  }

  /** Autorizaciones dadas en un rango de fechas, con lo que realmente se trabajo cada dia. */
  async listAuthorizations(actor: AuthenticatedUser, from: string, to: string) {
    await this.assertCanApprove(actor);
    const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v ?? '') && !Number.isNaN(Date.parse(`${v}T00:00:00`));
    if (!isDate(from) || !isDate(to)) throw new BadRequestException('"from" y "to" deben ser fechas validas (YYYY-MM-DD).');
    const fromDate = new Date(`${from}T00:00:00`);
    const toDate = new Date(`${to}T00:00:00`);
    if (toDate < fromDate || (toDate.getTime() - fromDate.getTime()) / 86_400_000 > MAX_RANGE_DAYS) {
      throw new BadRequestException(`El rango debe ser valido y de maximo ${MAX_RANGE_DAYS} dias.`);
    }
    const rows = await this.prisma.overtimeAuthorization.findMany({
      where: { workDate: { gte: fromDate, lte: toDate }, user: { companyId: actor.companyId } },
      orderBy: [{ workDate: 'desc' }, { updatedAt: 'desc' }],
      select: { userId: true, workDate: true },
    });
    return Promise.all(rows.map((row) => this.describe(row.userId, row.workDate)));
  }
}
