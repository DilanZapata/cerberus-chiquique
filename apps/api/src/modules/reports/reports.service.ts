import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { PAYROLL_REPORT_NOVELTY_CODES } from '@cerberus/shared-types';
import { PrismaService } from '../../database/prisma.service';

const PERMISSION_CODES = new Set(['PERMISO_REMUNERADO', 'PERMISO_NO_REMUNERADO', 'PERMISO_SALIDA_TEMPORAL']);
const SICK_LEAVE_CODES = new Set(['INCAPACIDAD_GENERAL', 'INCAPACIDAD_ARL']);

function clippedDaySpan(start: Date, end: Date, from: Date, to: Date): number {
  const clippedStart = start > from ? start : from;
  const clippedEnd = end < to ? end : to;
  const days = Math.round((clippedEnd.getTime() - clippedStart.getTime()) / 86_400_000) + 1;
  return Math.max(0, days);
}

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async buildPayrollWorkbook(companyId: string, from: string, to: string): Promise<ExcelJS.Workbook> {
    const fromDate = new Date(`${from}T00:00:00`);
    const toDate = new Date(`${to}T00:00:00`);

    const users = await this.prisma.user.findMany({
      where: { companyId, isActive: true },
      orderBy: { employeeCode: 'asc' },
    });
    const userIds = users.map((u) => u.id);

    const [novelties, totals, incidences] = await Promise.all([
      this.prisma.novelty.findMany({
        where: { userId: { in: userIds }, workDate: { gte: fromDate, lte: toDate } },
      }),
      this.prisma.attendanceDailyTotal.findMany({
        where: { userId: { in: userIds }, workDate: { gte: fromDate, lte: toDate } },
      }),
      this.prisma.incidence.findMany({
        where: {
          userId: { in: userIds },
          status: 'APROBADA',
          startDate: { lte: toDate },
          endDate: { gte: fromDate },
        },
      }),
    ]);

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Nomina');
    sheet.columns = [
      { header: 'Codigo', key: 'employeeCode', width: 12 },
      { header: 'Cedula', key: 'nationalId', width: 15 },
      { header: 'Nombre', key: 'fullName', width: 28 },
      { header: 'RNO', key: 'RNO', width: 10 },
      { header: 'DDCOF', key: 'DDCOF', width: 10 },
      { header: 'DNCOF', key: 'DNCOF', width: 10 },
      { header: 'HEOD', key: 'HEOD', width: 10 },
      { header: 'HEON', key: 'HEON', width: 10 },
      { header: 'HEFD', key: 'HEFD', width: 10 },
      { header: 'HEFN', key: 'HEFN', width: 10 },
      { header: 'Horas no autorizadas', key: 'unauthorizedHours', width: 20 },
      { header: 'Total horas trabajadas', key: 'totalWorkedHours', width: 20 },
      { header: 'Dias ausencia', key: 'daysAbsent', width: 14 },
      { header: 'Dias permiso', key: 'daysPermission', width: 14 },
      { header: 'Dias incapacidad', key: 'daysSickLeave', width: 16 },
    ];
    sheet.getRow(1).font = { bold: true };

    for (const user of users) {
      const userNovelties = novelties.filter((n) => n.userId === user.id);
      const row: Record<string, string | number> = {
        employeeCode: user.employeeCode,
        nationalId: user.nationalId,
        fullName: user.fullName,
      };

      for (const code of PAYROLL_REPORT_NOVELTY_CODES) {
        row[code] = userNovelties
          .filter((n) => n.code === code && n.status !== 'PENDIENTE' && n.status !== 'RECHAZADA')
          .reduce((sum, n) => sum + n.hours.toNumber(), 0);
      }

      row.unauthorizedHours = userNovelties
        .filter((n) => n.status === 'PENDIENTE')
        .reduce((sum, n) => sum + n.hours.toNumber(), 0);

      row.totalWorkedHours = totals
        .filter((t) => t.userId === user.id)
        .reduce((sum, t) => sum + t.totalWorkedHours.toNumber(), 0);

      row.daysAbsent = userNovelties.filter((n) => n.code === 'AUSENCIA_INJUSTIFICADA').length;

      const userIncidences = incidences.filter((i) => i.userId === user.id);
      row.daysPermission = userIncidences
        .filter((i) => PERMISSION_CODES.has(i.code))
        .reduce((sum, i) => sum + clippedDaySpan(i.startDate, i.endDate, fromDate, toDate), 0);
      row.daysSickLeave = userIncidences
        .filter((i) => SICK_LEAVE_CODES.has(i.code))
        .reduce((sum, i) => sum + clippedDaySpan(i.startDate, i.endDate, fromDate, toDate), 0);

      sheet.addRow(row);
    }

    return workbook;
  }
}
