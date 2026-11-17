import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { isColombianHoliday } from '@cerberus/cst-rules';
import { PrismaService } from '../../database/prisma.service';
import { addDays } from '../../common/utils/time.util';
import { NoveltiesService } from '../novelties/novelties.service';

/**
 * Los 7 conceptos de nomina, en el MISMO orden de columnas de la planilla
 * manual en Excel que esta vista reemplaza (HEOD, HEON, HEFD, HEFN, RNO,
 * DDCoF, DNCoF).
 */
export const GRID_CONCEPTS = ['HEOD', 'HEON', 'HEFD', 'HEFN', 'RNO', 'DDCOF', 'DNCOF'] as const;
export type GridConcept = (typeof GRID_CONCEPTS)[number];

const CONCEPT_LABELS: Record<GridConcept, string> = {
  HEOD: 'HEOD',
  HEON: 'HEON',
  HEFD: 'HEFD',
  HEFN: 'HEFN',
  RNO: 'RNO',
  DDCOF: 'DDCoF',
  DNCOF: 'DNCoF',
};

const OVERTIME_CONCEPTS = new Set<string>(['HEOD', 'HEON', 'HEFD', 'HEFN']);

const OTHER_NOVELTY_LABELS: Record<string, string> = {
  LLEGADA_TARDE: 'Llegada tarde',
  LLEGADA_TARDE_ALMUERZO: 'Reingreso tarde de almuerzo',
  ABANDONO_ALMUERZO: 'No volvio de almuerzo',
  SALIDA_ANTICIPADA: 'Salida anticipada',
  AUSENCIA_INJUSTIFICADA: 'Ausencia injustificada',
  PERMISO_REMUNERADO: 'Permiso remunerado',
  PERMISO_NO_REMUNERADO: 'Permiso no remunerado',
  PERMISO_SALIDA_TEMPORAL: 'Permiso de salida temporal',
  INCAPACIDAD_GENERAL: 'Incapacidad general',
  INCAPACIDAD_ARL: 'Incapacidad ARL',
  VACACIONES: 'Vacaciones',
  DESCANSO_COMPENSATORIO_PENDIENTE: 'Descanso compensatorio pendiente',
  LIMITE_HORAS_EXTRA_EXCEDIDO: 'Supero el tope legal de horas extra',
  SALIDA_NO_REGISTRADA: 'No marco salida (cierre automatico)',
  JORNADA_REQUIERE_REVISION: 'Jornada requiere revision',
  SIN_DESCANSO_SEMANAL: 'Sin descanso semanal',
};

// HORA_EXTRA_PENDIENTE es solo el agregado que alimenta el panel de
// aprobacion; sus horas ya estan en HEOD/HEON/HEFD/HEFN, no se repite.
const HIDDEN_NOVELTY_CODES = new Set<string>(['HORA_EXTRA_PENDIENTE']);

const PERMISSION_CODES = new Set(['PERMISO_REMUNERADO', 'PERMISO_NO_REMUNERADO', 'PERMISO_SALIDA_TEMPORAL']);
const SICK_LEAVE_CODES = new Set(['INCAPACIDAD_GENERAL', 'INCAPACIDAD_ARL']);

const MAX_RANGE_DAYS = 62;
const MONTH_NAMES = [
  'ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO',
  'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE',
];
const HOUR_LABELS = ['12-1', '1-2', '2-3', '3-4', '4-5', '5-6', '6-7', '7-8', '8-9', '9-10', '10-11', '11-12'];

export interface ConceptHours {
  /** Horas que SI entran a nomina: calculadas automaticamente o ya aprobadas. */
  payable: number;
  /** Horas extra aun sin decidir por un supervisor. */
  pending: number;
  /** Horas extra trabajadas pero rechazadas (no se pagan, pero quedan documentadas). */
  rejected: number;
}

export interface AttendanceGridDay {
  date: string;
  dayOfMonth: number;
  /** 0 = domingo ... 6 = sabado. */
  weekday: number;
  isSunday: boolean;
  isHoliday: boolean;
  /** Horario programado ("HH:mm-HH:mm"), "Descanso", o null si no tiene horario ese dia. */
  planned: string | null;
  marks: { checkIn: string | null; lunchOut: string | null; lunchIn: string | null; checkOut: string | null };
  /** Fraccion trabajada en cada hora de reloj (0-23) de ESTE dia calendario. */
  hours: number[];
  workedHours: number;
  concepts: Record<GridConcept, ConceptHours>;
  others: Array<{ code: string; label: string; hours: number; status: string; notes: string | null }>;
}

export interface AttendanceGridTotals {
  concepts: Record<GridConcept, ConceptHours>;
  workedHours: number;
  ordinaryHours: number;
  pendingOvertimeHours: number;
  rejectedOvertimeHours: number;
  lateCount: number;
  lateHours: number;
  earlyExitCount: number;
  earlyExitHours: number;
  absenceCount: number;
  permissionDays: number;
  sickLeaveDays: number;
  daysWorked: number;
}

export interface AttendanceGrid {
  employee: { id: string; fullName: string; employeeCode: string; nationalId: string };
  from: string;
  to: string;
  days: AttendanceGridDay[];
  totals: AttendanceGridTotals;
}

type GridUser = { id: string; fullName: string; employeeCode: string; nationalId: string; allowsLunchSkip: boolean };

function localKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function emptyConcepts(): Record<GridConcept, ConceptHours> {
  return Object.fromEntries(GRID_CONCEPTS.map((c) => [c, { payable: 0, pending: 0, rejected: 0 }])) as Record<
    GridConcept,
    ConceptHours
  >;
}

function hhmm(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/**
 * Planilla de asistencia por persona: la misma cuadricula que se llevaba a
 * mano en Excel (una fila por dia, 24 columnas de hora, y las 7 columnas de
 * novedades de nomina), pero armada desde las marcas reales y desde las
 * novedades que YA calculo el motor de nomina -- esta vista no recalcula
 * nada, solo lee, para que lo que se ve aqui sea exactamente lo que sale en
 * el reporte de nomina.
 */
@Injectable()
export class AttendanceGridService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly noveltiesService: NoveltiesService,
  ) {}

  private parseRange(from: string, to: string): { fromDate: Date; toDate: Date } {
    const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v ?? '') && !Number.isNaN(Date.parse(`${v}T00:00:00`));
    if (!isDate(from) || !isDate(to)) {
      throw new BadRequestException('"from" y "to" son requeridos y deben ser fechas validas (YYYY-MM-DD).');
    }
    const fromDate = new Date(`${from}T00:00:00`);
    const toDate = new Date(`${to}T00:00:00`);
    if (toDate < fromDate) throw new BadRequestException('"to" no puede ser anterior a "from".');
    const rangeDays = Math.round((toDate.getTime() - fromDate.getTime()) / 86_400_000) + 1;
    if (rangeDays > MAX_RANGE_DAYS) {
      throw new BadRequestException(`El rango no puede superar ${MAX_RANGE_DAYS} dias.`);
    }
    return { fromDate, toDate };
  }

  async getGrid(companyId: string, userId: string, from: string, to: string): Promise<AttendanceGrid> {
    const { fromDate, toDate } = this.parseRange(from, to);
    const user = await this.prisma.user.findFirst({
      where: { id: userId, companyId },
      select: { id: true, fullName: true, employeeCode: true, nationalId: true, allowsLunchSkip: true },
    });
    if (!user) throw new NotFoundException(`Empleado ${userId} no encontrado`);
    return this.buildGrid(user, fromDate, toDate);
  }

  private async buildGrid(user: GridUser, fromDate: Date, toDate: Date): Promise<AttendanceGrid> {
    const from = localKey(fromDate);
    const to = localKey(toDate);

    // Un turno nocturno que inicio el dia ANTERIOR al rango deja horas en la
    // madrugada del primer dia: por eso las marcas se leen desde from-1.
    const scanStart = addDays(fromDate, -1);
    const [checkIns, novelties, dailyTotals] = await Promise.all([
      this.prisma.timeLog.findMany({
        where: { userId: user.id, logType: 'CHECK_IN', loggedAt: { gte: scanStart, lt: addDays(toDate, 1) } },
        select: { loggedAt: true },
      }),
      this.prisma.novelty.findMany({
        where: { userId: user.id, workDate: { gte: fromDate, lte: toDate } },
        orderBy: { code: 'asc' },
      }),
      this.prisma.attendanceDailyTotal.findMany({
        where: { userId: user.id, workDate: { gte: fromDate, lte: toDate } },
      }),
    ]);

    const daysWithCheckIn = new Set(checkIns.map((l) => localKey(l.loggedAt)));

    // Minutos trabajados por (dia calendario, hora de reloj), y marcas por
    // dia de INICIO del turno.
    const minutesByDayHour = new Map<string, number[]>();
    const marksByDay = new Map<string, AttendanceGridDay['marks']>();

    for (let day = scanStart; day <= toDate; day = addDays(day, 1)) {
      const key = localKey(day);
      if (!daysWithCheckIn.has(key)) continue;

      const { marks, segments } = await this.noveltiesService.getWorkedSegmentsForDay(user.id, day, user.allowsLunchSkip);
      marksByDay.set(key, {
        checkIn: marks.checkIn?.toISOString() ?? null,
        lunchOut: marks.lunchOut?.toISOString() ?? null,
        lunchIn: marks.lunchIn?.toISOString() ?? null,
        checkOut: marks.checkOut?.toISOString() ?? null,
      });

      for (const segment of segments) {
        // Recorre el intervalo hora por hora de reloj, repartiendo los
        // minutos en la celda (dia calendario, hora) que corresponda.
        let cursor = new Date(segment.start);
        while (cursor < segment.end) {
          const nextHour = new Date(cursor);
          nextHour.setMinutes(0, 0, 0);
          nextHour.setHours(nextHour.getHours() + 1);
          const sliceEnd = nextHour < segment.end ? nextHour : segment.end;
          const cellKey = localKey(cursor);
          const cells = minutesByDayHour.get(cellKey) ?? new Array<number>(24).fill(0);
          cells[cursor.getHours()] += (sliceEnd.getTime() - cursor.getTime()) / 60_000;
          minutesByDayHour.set(cellKey, cells);
          cursor = sliceEnd;
        }
      }
    }

    const noveltiesByDay = new Map<string, typeof novelties>();
    for (const novelty of novelties) {
      const key = novelty.workDate.toISOString().slice(0, 10);
      const list = noveltiesByDay.get(key) ?? [];
      list.push(novelty);
      noveltiesByDay.set(key, list);
    }
    const ordinaryByDay = new Map(dailyTotals.map((t) => [t.workDate.toISOString().slice(0, 10), t.totalOrdinaryHours.toNumber()]));

    const totals: AttendanceGridTotals = {
      concepts: emptyConcepts(),
      workedHours: 0,
      ordinaryHours: 0,
      pendingOvertimeHours: 0,
      rejectedOvertimeHours: 0,
      lateCount: 0,
      lateHours: 0,
      earlyExitCount: 0,
      earlyExitHours: 0,
      absenceCount: 0,
      permissionDays: 0,
      sickLeaveDays: 0,
      daysWorked: 0,
    };

    const days: AttendanceGridDay[] = [];
    for (let day = fromDate; day <= toDate; day = addDays(day, 1)) {
      const key = localKey(day);
      const hours = (minutesByDayHour.get(key) ?? new Array<number>(24).fill(0)).map((m) => round2(m / 60));
      const workedHours = round2(hours.reduce((sum, h) => sum + h, 0));

      const concepts = emptyConcepts();
      const others: AttendanceGridDay['others'] = [];
      for (const novelty of noveltiesByDay.get(key) ?? []) {
        const hoursValue = novelty.hours.toNumber();
        if ((GRID_CONCEPTS as readonly string[]).includes(novelty.code)) {
          const bucket = novelty.status === 'PENDIENTE' ? 'pending' : novelty.status === 'RECHAZADA' ? 'rejected' : 'payable';
          concepts[novelty.code as GridConcept][bucket] = round2(concepts[novelty.code as GridConcept][bucket] + hoursValue);
          continue;
        }
        if (HIDDEN_NOVELTY_CODES.has(novelty.code)) continue;
        others.push({
          code: novelty.code,
          label: OTHER_NOVELTY_LABELS[novelty.code] ?? novelty.code,
          hours: hoursValue,
          status: novelty.status,
          notes: novelty.notes,
        });

        if (novelty.code === 'LLEGADA_TARDE') {
          totals.lateCount += 1;
          totals.lateHours = round2(totals.lateHours + hoursValue);
        } else if (novelty.code === 'SALIDA_ANTICIPADA') {
          totals.earlyExitCount += 1;
          totals.earlyExitHours = round2(totals.earlyExitHours + hoursValue);
        } else if (novelty.code === 'AUSENCIA_INJUSTIFICADA') {
          totals.absenceCount += 1;
        } else if (PERMISSION_CODES.has(novelty.code)) {
          totals.permissionDays += 1;
        } else if (SICK_LEAVE_CODES.has(novelty.code)) {
          totals.sickLeaveDays += 1;
        }
      }

      for (const concept of GRID_CONCEPTS) {
        const t = totals.concepts[concept];
        t.payable = round2(t.payable + concepts[concept].payable);
        t.pending = round2(t.pending + concepts[concept].pending);
        t.rejected = round2(t.rejected + concepts[concept].rejected);
        if (OVERTIME_CONCEPTS.has(concept)) {
          totals.pendingOvertimeHours = round2(totals.pendingOvertimeHours + concepts[concept].pending);
          totals.rejectedOvertimeHours = round2(totals.rejectedOvertimeHours + concepts[concept].rejected);
        }
      }
      totals.workedHours = round2(totals.workedHours + workedHours);
      totals.ordinaryHours = round2(totals.ordinaryHours + (ordinaryByDay.get(key) ?? 0));
      if (workedHours > 0) totals.daysWorked += 1;

      const shift = await this.noveltiesService.getPlannedShift(user.id, day);
      const planned = shift.plannedShift
        ? `${hhmm(shift.plannedShift.start)}-${hhmm(shift.plannedShift.end)}`
        : shift.isScheduledRestDay
          ? 'Descanso'
          : null;

      days.push({
        date: key,
        dayOfMonth: day.getDate(),
        weekday: day.getDay(),
        isSunday: day.getDay() === 0,
        isHoliday: isColombianHoliday(day),
        planned,
        marks: marksByDay.get(key) ?? { checkIn: null, lunchOut: null, lunchIn: null, checkOut: null },
        hours,
        workedHours,
        concepts,
        others,
      });
    }

    return {
      employee: { id: user.id, fullName: user.fullName, employeeCode: user.employeeCode, nationalId: user.nationalId },
      from,
      to,
      days,
      totals,
    };
  }

  /**
   * Excel con el mismo formato de la planilla manual: una hoja por persona
   * (dia, fecha, 24 columnas de hora en C..Z, y los 7 conceptos en AA..AG,
   * con la fila de totales junto al nombre y la cedula) mas una hoja
   * "Resumen" con los totales de todos. Con `userId` sale solo esa persona.
   */
  async buildWorkbook(companyId: string, from: string, to: string, userId?: string): Promise<ExcelJS.Workbook> {
    const { fromDate, toDate } = this.parseRange(from, to);
    const users = await this.prisma.user.findMany({
      where: userId ? { id: userId, companyId } : { companyId, isActive: true, role: 'EMPLOYEE' },
      select: { id: true, fullName: true, employeeCode: true, nationalId: true, allowsLunchSkip: true },
      orderBy: { fullName: 'asc' },
    });
    if (userId && users.length === 0) throw new NotFoundException(`Empleado ${userId} no encontrado`);

    const grids: AttendanceGrid[] = [];
    for (const user of users) grids.push(await this.buildGrid(user, fromDate, toDate));

    const workbook = new ExcelJS.Workbook();
    this.addSummarySheet(workbook, grids, from, to);
    const usedNames = new Set<string>(['Resumen']);
    for (const grid of grids) this.addEmployeeSheet(workbook, grid, toDate, usedNames);
    return workbook;
  }

  private addSummarySheet(workbook: ExcelJS.Workbook, grids: AttendanceGrid[], from: string, to: string) {
    const sheet = workbook.addWorksheet('Resumen');
    sheet.addRow([`RESUMEN DE NOVEDADES DE NOMINA — Periodo ${from} a ${to}`]).font = { bold: true, size: 13 };
    sheet.addRow([]);
    // Mismo orden de columnas del resumen manual: RNO, DDCoF, DNCoF, HEOD, HEON, HEFD, HEFN.
    const order: GridConcept[] = ['RNO', 'DDCOF', 'DNCOF', 'HEOD', 'HEON', 'HEFD', 'HEFN'];
    const header = sheet.addRow([
      'Nombre',
      'Cedula',
      'Codigo',
      ...order.map((c) => CONCEPT_LABELS[c]),
      'HE pendientes de aprobar',
      'HE rechazadas',
      'Horas trabajadas',
      'Horas ordinarias',
      'Dias trabajados',
      'Llegadas tarde',
      'Horas de tardanza',
      'Salidas anticipadas',
      'Ausencias',
      'Dias permiso',
      'Dias incapacidad',
    ]);
    header.font = { bold: true };
    header.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
      cell.alignment = { wrapText: true, vertical: 'middle', horizontal: 'center' };
    });

    for (const grid of grids) {
      const t = grid.totals;
      sheet.addRow([
        grid.employee.fullName,
        grid.employee.nationalId,
        grid.employee.employeeCode,
        ...order.map((c) => t.concepts[c].payable),
        t.pendingOvertimeHours,
        t.rejectedOvertimeHours,
        t.workedHours,
        t.ordinaryHours,
        t.daysWorked,
        t.lateCount,
        t.lateHours,
        t.earlyExitCount,
        t.absenceCount,
        t.permissionDays,
        t.sickLeaveDays,
      ]);
    }

    sheet.getColumn(1).width = 34;
    sheet.getColumn(2).width = 14;
    sheet.getColumn(3).width = 12;
    for (let c = 4; c <= 21; c++) sheet.getColumn(c).width = 12;
    sheet.addRow([]);
    sheet.addRow([
      'Las columnas RNO..HEFN solo incluyen horas que SI entran a nomina (calculadas o ya aprobadas). Las horas extra pendientes o rechazadas van en sus propias columnas.',
    ]).font = { italic: true, size: 9 };
  }

  private addEmployeeSheet(workbook: ExcelJS.Workbook, grid: AttendanceGrid, toDate: Date, usedNames: Set<string>) {
    // Nombre de hoja: Excel admite maximo 31 caracteres y prohibe \ / ? * [ ] :
    const base = grid.employee.fullName.replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 28) || grid.employee.employeeCode;
    let name = base;
    for (let i = 2; usedNames.has(name); i++) name = `${base.slice(0, 26)} ${i}`;
    usedNames.add(name);
    const sheet = workbook.addWorksheet(name);

    const FIRST_HOUR_COL = 3; // C
    const FIRST_CONCEPT_COL = 27; // AA
    const PENDING_COL = 34; // AH
    const REJECTED_COL = 35; // AI
    const IN_COL = 36; // AJ
    const OUT_COL = 37; // AK
    const WORKED_COL = 38; // AL
    const NOTES_COL = 39; // AM

    const title = sheet.addRow([
      `${grid.employee.fullName} — CC ${grid.employee.nationalId} — Codigo ${grid.employee.employeeCode} — Periodo ${grid.from} a ${grid.to}`,
    ]);
    title.font = { bold: true, size: 12 };

    const header = sheet.getRow(2);
    header.getCell(1).value = MONTH_NAMES[toDate.getMonth()];
    header.getCell(2).value = 'Fecha';
    for (let h = 0; h < 24; h++) header.getCell(FIRST_HOUR_COL + h).value = HOUR_LABELS[h % 12];
    GRID_CONCEPTS.forEach((c, i) => (header.getCell(FIRST_CONCEPT_COL + i).value = CONCEPT_LABELS[c]));
    header.getCell(PENDING_COL).value = 'HE pend.';
    header.getCell(REJECTED_COL).value = 'HE rech.';
    header.getCell(IN_COL).value = 'Entrada';
    header.getCell(OUT_COL).value = 'Salida';
    header.getCell(WORKED_COL).value = 'Horas';
    header.getCell(NOTES_COL).value = 'Observaciones';
    header.font = { bold: true };
    header.alignment = { horizontal: 'center' };
    for (let c = 1; c <= NOTES_COL; c++) {
      header.getCell(c).fill = {
        type: 'pattern',
        pattern: 'solid',
        // a.m. / p.m. con tonos distintos para ubicar rapido el mediodia.
        fgColor: { argb: c >= FIRST_HOUR_COL + 12 && c < FIRST_CONCEPT_COL ? 'FFCBD5E1' : 'FFE2E8F0' },
      };
    }

    const firstDataRow = 3;
    grid.days.forEach((day, index) => {
      const row = sheet.getRow(firstDataRow + index);
      row.getCell(1).value = day.dayOfMonth;
      row.getCell(2).value = day.date;
      day.hours.forEach((value, h) => {
        if (value > 0) row.getCell(FIRST_HOUR_COL + h).value = value;
      });
      let pending = 0;
      let rejected = 0;
      GRID_CONCEPTS.forEach((c, i) => {
        if (day.concepts[c].payable > 0) row.getCell(FIRST_CONCEPT_COL + i).value = day.concepts[c].payable;
        if (OVERTIME_CONCEPTS.has(c)) {
          pending += day.concepts[c].pending;
          rejected += day.concepts[c].rejected;
        }
      });
      if (pending > 0) row.getCell(PENDING_COL).value = round2(pending);
      if (rejected > 0) row.getCell(REJECTED_COL).value = round2(rejected);
      if (day.marks.checkIn) row.getCell(IN_COL).value = hhmm(new Date(day.marks.checkIn));
      if (day.marks.checkOut) row.getCell(OUT_COL).value = hhmm(new Date(day.marks.checkOut));
      if (day.workedHours > 0) row.getCell(WORKED_COL).value = day.workedHours;
      const notes = [
        day.isHoliday ? 'Festivo' : null,
        ...day.others.map((o) => (o.hours > 0 ? `${o.label} (${o.hours}h)` : o.label)),
      ].filter(Boolean);
      if (notes.length) row.getCell(NOTES_COL).value = notes.join('; ');

      if (day.isSunday || day.isHoliday) {
        for (let c = 1; c <= NOTES_COL; c++) {
          row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } };
        }
      }
      for (let h = 0; h < 24; h++) row.getCell(FIRST_HOUR_COL + h).alignment = { horizontal: 'center' };
    });

    const lastDataRow = firstDataRow + grid.days.length - 1;
    const totalsRow = sheet.getRow(lastDataRow + 2);
    totalsRow.getCell(1).value = grid.employee.fullName;
    totalsRow.getCell(5).value = 'CC';
    totalsRow.getCell(6).value = grid.employee.nationalId;
    const columnLetter = (col: number) => sheet.getColumn(col).letter;
    for (const col of [...GRID_CONCEPTS.map((_, i) => FIRST_CONCEPT_COL + i), PENDING_COL, REJECTED_COL, WORKED_COL]) {
      const letter = columnLetter(col);
      totalsRow.getCell(col).value = { formula: `SUM(${letter}${firstDataRow}:${letter}${lastDataRow})` };
    }
    totalsRow.font = { bold: true };

    sheet.getColumn(1).width = 6;
    sheet.getColumn(2).width = 11;
    for (let h = 0; h < 24; h++) sheet.getColumn(FIRST_HOUR_COL + h).width = 5.5;
    for (let c = FIRST_CONCEPT_COL; c <= WORKED_COL; c++) sheet.getColumn(c).width = 8.5;
    sheet.getColumn(NOTES_COL).width = 60;
    sheet.views = [{ state: 'frozen', xSplit: 2, ySplit: 2 }];
  }
}
