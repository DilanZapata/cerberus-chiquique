import { Controller, Get, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { UserRole } from '@prisma/client';
import { ReportsService } from './reports.service';
import { Roles } from '../../common/decorators/roles.decorator';

@Roles(UserRole.ADMIN, UserRole.HR)
@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('payroll')
  async payroll(
    @Query('companyId') companyId: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Res() res: Response,
  ) {
    const workbook = await this.reportsService.buildPayrollWorkbook(companyId, from, to);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="nomina_${from}_${to}.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
  }
}
