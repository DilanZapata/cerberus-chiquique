import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../database/prisma.service';
import { MailerService } from './mailer.service';

type PendingOvertimeRow = { requestedHours: { toString(): string }; createdAt: Date; novelty: { workDate: Date; user: { fullName: string; employeeCode: string } } };
type PendingIncidenceRow = { code: string; startDate: Date; endDate: Date; createdAt: Date; user: { fullName: string; employeeCode: string } };

/**
 * Envia (cron diario, ademas de disparo manual) un resumen a los correos
 * administrativos configurados por empresa con las horas extra e
 * incidencias que llevan mas de `overtimePendingAlertDays` sin autorizar.
 */
@Injectable()
export class WeeklyAlertService {
  private readonly logger = new Logger(WeeklyAlertService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailerService: MailerService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_7AM)
  async checkAndSendAlerts(): Promise<void> {
    const companies = await this.prisma.company.findMany({ include: { emailSettings: true } });
    for (const company of companies) {
      if (!company.emailSettings?.weeklyAlertEnabled) continue;
      try {
        await this.sendSummaryForCompany(company.id);
      } catch (error) {
        this.logger.error(`Fallo el envio de alertas para la empresa ${company.id}: ${(error as Error).message}`);
      }
    }
  }

  async sendSummaryForCompany(companyId: string) {
    const settings = await this.prisma.payrollSettings.findUnique({ where: { companyId } });
    const alertDays = settings?.overtimePendingAlertDays ?? 7;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - alertDays);

    const [pendingOvertime, pendingIncidences] = await Promise.all([
      this.prisma.overtimeApproval.findMany({
        where: { status: 'PENDIENTE', createdAt: { lt: cutoff }, novelty: { user: { companyId } } },
        include: { novelty: { include: { user: { select: { fullName: true, employeeCode: true } } } } },
      }),
      this.prisma.incidence.findMany({
        where: { status: 'PENDIENTE', createdAt: { lt: cutoff }, user: { companyId } },
        include: { user: { select: { fullName: true, employeeCode: true } } },
      }),
    ]);

    if (pendingOvertime.length === 0 && pendingIncidences.length === 0) {
      return { sent: false, reason: 'Nada pendiente por encima del umbral configurado.' };
    }

    const html = this.buildSummaryHtml(pendingOvertime as PendingOvertimeRow[], pendingIncidences as PendingIncidenceRow[], alertDays);

    try {
      const recipients = await this.mailerService.sendMail(companyId, {
        subject: `Cerberus: novedades pendientes de autorizacion (+${alertDays} dias)`,
        html,
      });
      await this.prisma.notificationLog.create({
        data: {
          companyId,
          subject: 'Resumen semanal de novedades pendientes',
          recipients,
          payloadSummary: { overtimeCount: pendingOvertime.length, incidenceCount: pendingIncidences.length },
          status: 'SENT',
        },
      });
      return { sent: true, recipients };
    } catch (error) {
      await this.prisma.notificationLog.create({
        data: {
          companyId,
          subject: 'Resumen semanal de novedades pendientes',
          recipients: [],
          status: 'FAILED',
          errorMessage: (error as Error).message,
        },
      });
      throw error;
    }
  }

  private buildSummaryHtml(
    overtime: PendingOvertimeRow[],
    incidences: PendingIncidenceRow[],
    alertDays: number,
  ): string {
    const overtimeRows = overtime
      .map(
        (o) =>
          `<tr><td>${o.novelty.user.fullName} (${o.novelty.user.employeeCode})</td><td>${o.novelty.workDate.toISOString().slice(0, 10)}</td><td>${o.requestedHours.toString()} h</td></tr>`,
      )
      .join('');
    const incidenceRows = incidences
      .map(
        (i) =>
          `<tr><td>${i.user.fullName} (${i.user.employeeCode})</td><td>${i.code}</td><td>${i.startDate.toISOString().slice(0, 10)} - ${i.endDate.toISOString().slice(0, 10)}</td></tr>`,
      )
      .join('');

    return `
      <h2>Novedades pendientes de autorizacion (+${alertDays} dias)</h2>
      ${
        overtime.length
          ? `<h3>Horas extra (${overtime.length})</h3>
             <table border="1" cellpadding="6" cellspacing="0">
               <tr><th>Empleado</th><th>Fecha</th><th>Horas solicitadas</th></tr>
               ${overtimeRows}
             </table>`
          : ''
      }
      ${
        incidences.length
          ? `<h3>Permisos / incapacidades (${incidences.length})</h3>
             <table border="1" cellpadding="6" cellspacing="0">
               <tr><th>Empleado</th><th>Tipo</th><th>Rango</th></tr>
               ${incidenceRows}
             </table>`
          : ''
      }
      <p>Ingresa al panel administrativo de Cerberus para aprobar o rechazar.</p>
    `;
  }
}
