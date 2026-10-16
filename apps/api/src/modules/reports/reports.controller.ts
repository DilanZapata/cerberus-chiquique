import { Controller, Get, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { UserRole } from '@prisma/client';
import { ReportsService } from './reports.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';

@Roles(UserRole.ADMIN, UserRole.HR)
@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

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
}
