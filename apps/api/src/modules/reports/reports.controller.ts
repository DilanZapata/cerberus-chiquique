import { Controller, Get, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { UserRole } from '@prisma/client';
import { ReportsService } from './reports.service';
import { AttendanceGridService } from './attendance-grid.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';

@Roles(UserRole.ADMIN, UserRole.HR)
@Controller('reports')
export class ReportsController {
  constructor(
    private readonly reportsService: ReportsService,
    private readonly attendanceGridService: AttendanceGridService,
  ) {}

  /**
   * `companyId` SIEMPRE viene del JWT de quien consulta, nunca de la query
   * string -- antes de esta correccion se tomaba el `companyId` tal cual lo
   * mandara el cliente, permitiendo que el admin/HR de UNA empresa descargara
   * la nomina completa de OTRA solo cambiando ese parametro en la URL
   * (auditoria 2026-10-16, seccion C.1.c).
   */
  @Get('payroll')
  async payroll(
    @CurrentUser() user: AuthenticatedUser,
    @Query('from') from: string,
    @Query('to') to: string,
    @Res() res: Response,
  ) {
    const workbook = await this.reportsService.buildPayrollWorkbook(user.companyId, from, to);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="nomina_${from}_${to}.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
  }

  /**
   * Planilla por persona: una fila por dia con las 24 horas del dia y las 7
   * novedades de nomina (el formato de la planilla manual en Excel).
   */
  @Get('attendance-grid')
  attendanceGrid(
    @CurrentUser() user: AuthenticatedUser,
    @Query('userId') userId: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.attendanceGridService.getGrid(user.companyId, userId, from, to);
  }

  /** La misma planilla en Excel: una hoja por persona + hoja "Resumen". Con `userId`, solo esa persona. */
  @Get('attendance-grid/export')
  async attendanceGridExport(
    @CurrentUser() user: AuthenticatedUser,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('userId') userId: string | undefined,
    @Res() res: Response,
  ) {
    const workbook = await this.attendanceGridService.buildWorkbook(user.companyId, from, to, userId || undefined);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="planilla_${from}_${to}.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
  }
}
