import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PayrollConfigService } from './payroll-config.service';
import { CreatePayrollConfigVersionDto } from './dto/create-payroll-config-version.dto';
import { UpdatePayrollConfigVersionDto } from './dto/update-payroll-config-version.dto';
import { UpdatePayrollSettingsDto } from './dto/update-payroll-settings.dto';
import { Roles } from '../../common/decorators/roles.decorator';

@Roles(UserRole.ADMIN)
@Controller('payroll-config')
export class PayrollConfigController {
  constructor(private readonly payrollConfigService: PayrollConfigService) {}

  @Get(':companyId/versions')
  listVersions(@Param('companyId') companyId: string) {
    return this.payrollConfigService.listVersions(companyId);
  }

  @Post(':companyId/versions')
  createVersion(@Param('companyId') companyId: string, @Body() dto: CreatePayrollConfigVersionDto) {
    return this.payrollConfigService.createVersion(companyId, dto);
  }

  @Put(':companyId/versions/:id')
  updateVersion(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @Body() dto: UpdatePayrollConfigVersionDto,
  ) {
    return this.payrollConfigService.updateVersion(companyId, id, dto);
  }

  @Get(':companyId/settings')
  getSettings(@Param('companyId') companyId: string) {
    return this.payrollConfigService.getOrCreateSettings(companyId);
  }

  @Put(':companyId/settings')
  updateSettings(@Param('companyId') companyId: string, @Body() dto: UpdatePayrollSettingsDto) {
    return this.payrollConfigService.updateSettings(companyId, dto);
  }
}
