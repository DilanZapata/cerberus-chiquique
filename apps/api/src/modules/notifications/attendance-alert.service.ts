import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { NoveltyCode as PrismaNoveltyCode } from '@prisma/client';
import { DailyCalculationResult, NoveltyCode } from '@cerberus/shared-types';
import { PrismaService } from '../../database/prisma.service';
import { addDays, startOfLocalDay } from '../../common/utils/time.util';
import { NoveltiesService } from '../novelties/novelties.service';
import { MailerService } from './mailer.service';
import { timeLogPhotoPath } from '../../common/utils/photo-storage.util';

function localKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

const MARK_LABELS: Record<string, string> = {
  CHECK_IN: 'entrada',
  LUNCH_OUT: 'salida a almuerzo',
  LUNCH_IN: 'reingreso de almuerzo',
  CHECK_OUT: 'salida',
};

function hhmm(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/** Novedades de asistencia que van en el resumen diario, en el orden en que se listan. */
const SUMMARY_SECTIONS: Array<{ code: string; title: string }> = [
  { code: 'AUSENCIA_INJUSTIFICADA', title: 'Ausencias (no se presento en un dia laborable)' },
  { code: 'LLEGADA_TARDE', title: 'Llegadas tarde' },
  { code: 'SALIDA_ANTICIPADA', title: 'Salidas anticipadas' },
  { code: 'LLEGADA_TARDE_ALMUERZO', title: 'Reingreso tarde de almuerzo' },
  { code: 'ABANDONO_ALMUERZO', title: 'No volvio de almuerzo' },
  { code: 'SALIDA_NO_REGISTRADA', title: 'No marco salida (cerrada automaticamente)' },
  { code: 'JORNADA_REQUIERE_REVISION', title: 'Jornadas que requieren revision' },
  { code: 'HORA_EXTRA_PENDIENTE', title: 'Horas extra pendientes de aprobar' },
  { code: 'SIN_DESCANSO_SEMANAL', title: 'Sin descanso semanal' },
];

/**
 * Alertas de asistencia para la empresa y cierre diario:
 *
 *  - Al instante: cuando alguien marca la entrada tarde (kiosco o app), un
 *    correo a los destinatarios administrativos.
 *  - Cierre diario (00:30 hora Colombia, sobre el dia anterior): calcula el
 *    dia de todo empleado activo que NO tuvo ninguna marca -- sin esto, una
 *    ausencia nunca se generaba sola, porque el calculo solo se disparaba
 *    al registrar una marca -- y luego envia un resumen con las llegadas
 *    tarde, salidas anticipadas, ausencias y jornadas sin salida del dia.
 *
 * Los correos dependen de que la empresa tenga su SMTP configurado (Ajustes
 * > Correo) y `attendanceAlertsEnabled` activo; el cierre diario corre
 * siempre, con o sin correo.
 */
@Injectable()
export class AttendanceAlertService {
  private readonly logger = new Logger(AttendanceAlertService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailerService: MailerService,
    private readonly noveltiesService: NoveltiesService,
  ) {}

  private async alertsEnabled(companyId: string): Promise<boolean> {
    const settings = await this.prisma.emailSettings.findUnique({
      where: { companyId },
      select: { attendanceAlertsEnabled: true },
    });
    return !!settings?.attendanceAlertsEnabled;
  }

  /**
   * Llamar justo despues de registrar una ENTRADA de autoservicio (kiosco o
   * app). Si el calculo del dia arrojo llegada tarde, avisa por correo.
   * Nunca lanza: un fallo de correo no puede tumbar el registro de la marca.
   */
  async notifyLateArrival(userId: string, result: DailyCalculationResult, checkInAt: Date): Promise<void> {
    try {
      const late = result.novelties.find((n) => n.code === NoveltyCode.LLEGADA_TARDE);
      if (!late) return;

      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { companyId: true, fullName: true, employeeCode: true, department: { select: { name: true } } },
      });
      if (!user || !(await this.alertsEnabled(user.companyId))) return;

      const { plannedShift } = await this.noveltiesService.getPlannedShift(userId, startOfLocalDay(checkInAt));
      const lateMinutes = plannedShift ? Math.round((checkInAt.getTime() - plannedShift.start.getTime()) / 60_000) : null;
      const subject = `Cerberus: llegada tarde de ${user.fullName}`;
      const html = `
        <h2>Llegada tarde</h2>
        <p><strong>${user.fullName}</strong> (${user.employeeCode}${user.department ? `, ${user.department.name}` : ''})
        marco su entrada a las <strong>${hhmm(checkInAt)}</strong> del ${localKey(checkInAt)}.</p>
        ${plannedShift ? `<p>Su horario de entrada era a las ${hhmm(plannedShift.start)}${lateMinutes !== null ? ` — <strong>${lateMinutes} minutos tarde</strong>` : ''}.</p>` : ''}
        <p>Tiempo de tardanza que cuenta para nomina: ${late.hours} h.</p>
      `;
      await this.send(user.companyId, subject, html, { type: 'LATE_ARRIVAL', userId, workDate: result.workDate });
    } catch (error) {
      this.logger.error(`No se pudo enviar la alerta de llegada tarde (usuario ${userId}): ${(error as Error).message}`);
    }
  }

  /**
   * Aviso a la empresa cuando alguien marca con su cedula/codigo/PIN pero el
   * rostro de la foto NO es el que tiene enrolado (posible marcacion por
   * otra persona). La marca ya quedo registrada; el correo lleva la foto
   * adjunta para revisarla. Nunca lanza.
   */
  async notifyFaceMismatch(
    userId: string,
    mark: { loggedAt: Date; logType: string; workSiteName: string; photoUrl: string | null; distance: number | null },
  ): Promise<void> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { companyId: true, fullName: true, employeeCode: true, nationalId: true, department: { select: { name: true } } },
      });
      if (!user || !(await this.alertsEnabled(user.companyId))) return;

      const markLabel = MARK_LABELS[mark.logType] ?? mark.logType;
      const photoPath = mark.photoUrl ? timeLogPhotoPath(mark.photoUrl) : null;
      const [year, month, day] = localKey(mark.loggedAt).split('-');
      const subject = `Cerberus: el rostro no coincide en la marca de ${user.fullName}`;
      const html = `
        <h2>El rostro no coincide con el enrolado</h2>
        <p>Se registro una <strong>${markLabel}</strong> a nombre de <strong>${user.fullName}</strong>
        (${user.employeeCode}, CC ${user.nationalId}${user.department ? `, ${user.department.name}` : ''})
        el ${day}/${month}/${year} a las <strong>${hhmm(mark.loggedAt)}</strong> en ${mark.workSiteName}.</p>
        <p>La persona digito ese codigo o cedula, pero <strong>el rostro de la foto no coincide con el rostro enrolado</strong>
        de ese empleado. Puede ser que otra persona haya marcado por el, o una foto con mala luz o de lado.</p>
        <p>La marca <strong>si quedo registrada</strong>. ${photoPath ? 'La foto va adjunta a este correo; tambien' : 'La foto'}
        se puede ver en el panel web, en Historial de Marcas. Si no fue esa persona, corrige o borra la marca en
        Corregir Marcas y Novedades.</p>
        <p style="color:#64748b;font-size:12px">Si la foto si es de la persona, conviene volver a enrolar su rostro con buena luz
        (app Cerberus Managers, Empleados).</p>
      `;
      await this.send(
        user.companyId,
        subject,
        html,
        { type: 'FACE_MISMATCH', userId, loggedAt: mark.loggedAt.toISOString(), logType: mark.logType, distance: mark.distance },
        photoPath ? [{ filename: 'foto-de-la-marca.jpg', path: photoPath }] : undefined,
      );
    } catch (error) {
      this.logger.error(`No se pudo enviar la alerta de rostro que no coincide (usuario ${userId}): ${(error as Error).message}`);
    }
  }

  private async send(
    companyId: string,
    subject: string,
    html: string,
    payloadSummary: Record<string, unknown>,
    attachments?: Array<{ filename: string; path: string }>,
  ) {
    try {
      const recipients = await this.mailerService.sendMail(companyId, { subject, html, attachments });
      await this.prisma.notificationLog.create({
        data: { companyId, subject, recipients, payloadSummary: payloadSummary as object, status: 'SENT' },
      });
      return { sent: true, recipients };
    } catch (error) {
      await this.prisma.notificationLog.create({
        data: {
          companyId,
          subject,
          recipients: [],
          payloadSummary: payloadSummary as object,
          status: 'FAILED',
          errorMessage: (error as Error).message,
        },
      });
      throw error;
    }
  }

  /** Cierre automatico del dia ANTERIOR, para todas las empresas. */
  @Cron('30 0 * * *', { timeZone: 'America/Bogota' })
  async runDailyCloseCron(): Promise<void> {
    const workDate = localKey(addDays(startOfLocalDay(new Date()), -1));
    const companies = await this.prisma.company.findMany({ select: { id: true } });
    for (const company of companies) {
      try {
        const result = await this.closeDay(company.id, workDate);
        this.logger.log(`Cierre diario ${workDate} (empresa ${company.id}): ${JSON.stringify(result)}`);
        await this.sendDailySummary(company.id, workDate);
      } catch (error) {
        this.logger.error(`Fallo el cierre diario ${workDate} de la empresa ${company.id}: ${(error as Error).message}`);
      }
    }
  }

  /**
   * Calcula el dia de todo empleado activo de la empresa que aun no tiene
   * calculo para `workDate` (es decir, que no registro ninguna marca: toda
   * marca ya dispara su propio calculo). Los dias ya calculados NO se tocan.
   */
  async closeDay(companyId: string, workDate: string) {
    const date = new Date(`${workDate}T00:00:00`);
    const users = await this.prisma.user.findMany({
      where: {
        companyId,
        isActive: true,
        // No hay ausencia posible antes de la fecha de ingreso ni despues del retiro.
        hireDate: { lte: date },
        OR: [{ terminationDate: null }, { terminationDate: { gte: date } }],
      },
      select: { id: true },
    });
    const alreadyCalculated = new Set(
      (
        await this.prisma.attendanceDailyTotal.findMany({
          where: { workDate: date, userId: { in: users.map((u) => u.id) } },
          select: { userId: true },
        })
      ).map((t) => t.userId),
    );

    let calculated = 0;
    let absences = 0;
    let failed = 0;
    for (const user of users) {
      if (alreadyCalculated.has(user.id)) continue;
      try {
        const result = await this.noveltiesService.calculateAndPersistForDay(user.id, workDate);
        calculated += 1;
        if (result.novelties.some((n) => n.code === NoveltyCode.AUSENCIA_INJUSTIFICADA)) absences += 1;
      } catch (error) {
        failed += 1;
        this.logger.error(`Cierre diario ${workDate}: fallo el calculo del usuario ${user.id}: ${(error as Error).message}`);
      }
    }
    return { workDate, employees: users.length, alreadyCalculated: alreadyCalculated.size, calculated, absences, failed };
  }

  /** Cierra un rango de dias (para poner al dia fechas pasadas). Maximo 62 dias, nunca fechas futuras ni el dia de hoy. */
  async closeRange(companyId: string, from: string, to: string) {
    const start = new Date(`${from}T00:00:00`);
    const end = new Date(`${to}T00:00:00`);
    const today = startOfLocalDay(new Date());
    const results: Awaited<ReturnType<AttendanceAlertService['closeDay']>>[] = [];
    let count = 0;
    for (let day = start; day <= end && day < today && count < 62; day = addDays(day, 1), count++) {
      results.push(await this.closeDay(companyId, localKey(day)));
    }
    return results;
  }

  /** Resumen de asistencia del dia para la empresa. No envia nada si no hubo novedades o las alertas estan apagadas. */
  async sendDailySummary(companyId: string, workDate: string) {
    if (!(await this.alertsEnabled(companyId))) {
      return { sent: false, reason: 'Alertas de asistencia apagadas o correo (SMTP) sin configurar.' };
    }

    const date = new Date(`${workDate}T00:00:00`);
    const novelties = await this.prisma.novelty.findMany({
      where: {
        workDate: date,
        user: { companyId },
        code: { in: SUMMARY_SECTIONS.map((s) => s.code) as PrismaNoveltyCode[] },
      },
      include: { user: { select: { fullName: true, employeeCode: true } } },
      orderBy: { user: { fullName: 'asc' } },
    });
    // Una hora extra ya aprobada/rechazada no esta "pendiente": fuera del resumen.
    const relevant = novelties.filter((n) => n.code !== 'HORA_EXTRA_PENDIENTE' || n.status === 'PENDIENTE');
    if (relevant.length === 0) return { sent: false, reason: 'Sin novedades de asistencia ese dia.' };

    const sections = SUMMARY_SECTIONS.map((section) => {
      const rows = relevant.filter((n) => n.code === section.code);
      if (rows.length === 0) return '';
      const body = rows
        .map((n) => {
          const hours = n.hours.toNumber();
          return `<tr><td>${n.user.fullName} (${n.user.employeeCode})</td><td>${hours > 0 ? `${hours} h` : ''}</td><td>${n.notes ?? ''}</td></tr>`;
        })
        .join('');
      return `<h3>${section.title} (${rows.length})</h3>
        <table border="1" cellpadding="6" cellspacing="0">
          <tr><th>Empleado</th><th>Horas</th><th>Detalle</th></tr>${body}
        </table>`;
    }).join('');

    const html = `<h2>Resumen de asistencia del ${workDate}</h2>${sections}
      <p>Revisa el detalle en el panel administrativo de Cerberus (Planilla por persona / Corregir marcas y novedades).</p>`;
    return this.send(companyId, `Cerberus: resumen de asistencia del ${workDate}`, html, {
      type: 'DAILY_SUMMARY',
      workDate,
      count: relevant.length,
    });
  }
}
