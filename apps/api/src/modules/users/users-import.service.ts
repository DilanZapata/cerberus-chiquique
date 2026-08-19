import { BadRequestException, Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { BulkImportOptionsDto, ImportFieldMode } from './dto/bulk-import-options.dto';

const ROLE_LABELS: Record<UserRole, string> = {
  ADMIN: 'Administrador',
  HR: 'Recursos Humanos',
  SUPERVISOR: 'Supervisor',
  EMPLOYEE: 'Empleado',
};
const ROLE_BY_LABEL: Record<string, UserRole> = Object.fromEntries(
  Object.entries(ROLE_LABELS).map(([code, label]) => [normalize(label), code as UserRole]),
);

const SHEET_NAME = 'Empleados';
const TEMPLATE_ROWS = 500;

export interface BulkImportRowResult {
  row: number;
  employeeCode?: string;
  status: 'created' | 'error';
  message?: string;
}

export interface BulkImportResult {
  created: number;
  errors: BulkImportRowResult[];
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

/** Extrae texto plano de una celda de ExcelJS sin importar si viene como string, numero, fecha o rich text. */
function cellText(cell: ExcelJS.Cell | undefined): string {
  const value = cell?.value;
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object' && 'richText' in (value as unknown as Record<string, unknown>)) {
    return (value as unknown as { richText: Array<{ text: string }> }).richText.map((t) => t.text).join('');
  }
  if (typeof value === 'object' && 'result' in (value as unknown as Record<string, unknown>)) {
    return String((value as unknown as { result: unknown }).result ?? '');
  }
  return String(value).trim();
}

/** Acepta "AAAA-MM-DD" (lo que produce cellText sobre una celda de fecha real) y "DD/MM/AAAA" escrito a mano. */
function parseFlexibleDate(raw: string): Date | undefined {
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (iso) return new Date(`${raw.slice(0, 10)}T00:00:00`);
  const alt = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
  if (alt) {
    const [, d, m, y] = alt;
    return new Date(`${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}T00:00:00`);
  }
  return undefined;
}

@Injectable()
export class UsersImportService {
  constructor(private readonly prisma: PrismaService) {}

  async generateTemplate(companyId: string): Promise<ExcelJS.Workbook> {
    const [departments, workSites] = await Promise.all([
      this.prisma.department.findMany({ where: { companyId }, orderBy: { name: 'asc' } }),
      this.prisma.workSite.findMany({ where: { companyId }, orderBy: { name: 'asc' } }),
    ]);

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(SHEET_NAME);
    sheet.columns = [
      { header: 'Codigo empleado *', key: 'employeeCode', width: 18 },
      { header: 'Cedula *', key: 'nationalId', width: 16 },
      { header: 'Nombre completo *', key: 'fullName', width: 30 },
      { header: 'Fecha de ingreso * (AAAA-MM-DD)', key: 'hireDate', width: 26 },
      { header: 'Correo', key: 'email', width: 30 },
      { header: 'Rol (vacio = Empleado)', key: 'role', width: 22 },
      { header: 'Departamento (vacio = sin asignar)', key: 'department', width: 26 },
      { header: 'Sede (vacio = sin asignar)', key: 'workSite', width: 26 },
    ];
    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).alignment = { wrapText: true, vertical: 'middle' };

    const roleLabels = Object.values(ROLE_LABELS);
    const refSheet = workbook.addWorksheet('Listas (no borrar)');
    refSheet.state = 'veryHidden';
    roleLabels.forEach((label, i) => (refSheet.getCell(i + 1, 1).value = label));
    departments.forEach((d, i) => (refSheet.getCell(i + 1, 2).value = d.name));
    workSites.forEach((w, i) => (refSheet.getCell(i + 1, 3).value = w.name));

    for (let r = 2; r <= TEMPLATE_ROWS; r++) {
      sheet.getCell(r, 6).dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: [`'Listas (no borrar)'!$A$1:$A$${roleLabels.length}`],
      };
      if (departments.length) {
        sheet.getCell(r, 7).dataValidation = {
          type: 'list',
          allowBlank: true,
          formulae: [`'Listas (no borrar)'!$B$1:$B$${departments.length}`],
        };
      }
      if (workSites.length) {
        sheet.getCell(r, 8).dataValidation = {
          type: 'list',
          allowBlank: true,
          formulae: [`'Listas (no borrar)'!$C$1:$C$${workSites.length}`],
        };
      }
    }

    return workbook;
  }

  async bulkImport(companyId: string, buffer: Buffer, options: BulkImportOptionsDto): Promise<BulkImportResult> {
    const workbook = new ExcelJS.Workbook();
    try {
      // exceljs tipa `load` contra una version de @types/node distinta a la
      // de este proyecto (Buffer<ArrayBuffer> vs Buffer plano) -- choque de
      // tipos, no de runtime; Buffer.from(buffer) siempre produce un Buffer
      // valido para node en tiempo de ejecucion.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await workbook.xlsx.load(Buffer.from(buffer) as any);
    } catch {
      throw new BadRequestException('El archivo no es un .xlsx valido.');
    }
    const sheet = workbook.getWorksheet(SHEET_NAME) ?? workbook.worksheets[0];
    if (!sheet) throw new BadRequestException('El archivo no tiene ninguna hoja con datos.');

    const [departments, workSites] = await Promise.all([
      this.prisma.department.findMany({ where: { companyId } }),
      this.prisma.workSite.findMany({ where: { companyId } }),
    ]);
    const departmentIdByName = new Map(departments.map((d) => [normalize(d.name), d.id]));
    const workSiteIdByName = new Map(workSites.map((w) => [normalize(w.name), w.id]));

    const results: BulkImportRowResult[] = [];
    let created = 0;

    for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber++) {
      const row = sheet.getRow(rowNumber);
      const employeeCode = cellText(row.getCell(1));
      const nationalId = cellText(row.getCell(2));
      const fullName = cellText(row.getCell(3));
      const hireDateRaw = cellText(row.getCell(4));
      const email = cellText(row.getCell(5)) || undefined;
      const roleRaw = cellText(row.getCell(6));
      const departmentRaw = cellText(row.getCell(7));
      const workSiteRaw = cellText(row.getCell(8));

      if (!employeeCode && !nationalId && !fullName && !hireDateRaw) continue; // fila vacia de relleno

      const errors: string[] = [];
      if (!employeeCode) errors.push('falta el codigo de empleado');
      if (!nationalId) errors.push('falta la cedula');
      if (!fullName) errors.push('falta el nombre completo');

      let hireDate: Date | undefined;
      if (!hireDateRaw) {
        errors.push('falta la fecha de ingreso');
      } else {
        hireDate = parseFlexibleDate(hireDateRaw);
        if (!hireDate || Number.isNaN(hireDate.getTime())) {
          errors.push(`fecha de ingreso invalida ("${hireDateRaw}", usa AAAA-MM-DD)`);
        }
      }

      let role: UserRole = UserRole.EMPLOYEE;
      if (options.roleMode === ImportFieldMode.UNIFORM) {
        role = options.roleValue ?? UserRole.EMPLOYEE;
      } else if (roleRaw) {
        const matched = ROLE_BY_LABEL[normalize(roleRaw)];
        if (!matched) errors.push(`rol "${roleRaw}" no reconocido`);
        else role = matched;
      }

      let departmentId: string | undefined;
      if (options.departmentMode === ImportFieldMode.UNIFORM) {
        departmentId = options.departmentValue;
      } else if (departmentRaw) {
        const matched = departmentIdByName.get(normalize(departmentRaw));
        if (!matched) errors.push(`departamento "${departmentRaw}" no existe`);
        else departmentId = matched;
      }

      let workSiteId: string | undefined;
      if (options.workSiteMode === ImportFieldMode.UNIFORM) {
        workSiteId = options.workSiteValue;
      } else if (workSiteRaw) {
        const matched = workSiteIdByName.get(normalize(workSiteRaw));
        if (!matched) errors.push(`sede "${workSiteRaw}" no existe`);
        else workSiteId = matched;
      }

      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('correo invalido');

      if (errors.length) {
        results.push({ row: rowNumber, employeeCode: employeeCode || undefined, status: 'error', message: errors.join('; ') });
        continue;
      }

      try {
        await this.prisma.user.create({
          data: {
            companyId,
            employeeCode,
            nationalId,
            fullName,
            email,
            role,
            departmentId,
            workSiteId,
            hireDate: hireDate!,
          },
        });
        created++;
        results.push({ row: rowNumber, employeeCode, status: 'created' });
      } catch (err) {
        const message =
          err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
            ? 'el codigo de empleado o la cedula ya existen en esta empresa'
            : 'error inesperado al crear el empleado';
        results.push({ row: rowNumber, employeeCode, status: 'error', message });
      }
    }

    return { created, errors: results.filter((r) => r.status === 'error') };
  }
}
