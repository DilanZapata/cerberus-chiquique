import { Body, Controller, ForbiddenException, Get, Param, Post, Put } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PayrollConfigService } from './payroll-config.service';
import { CreatePayrollConfigVersionDto } from './dto/create-payroll-config-version.dto';
import { UpdatePayrollConfigVersionDto } from './dto/update-payroll-config-version.dto';
import { UpdatePayrollSettingsDto } from './dto/update-payroll-settings.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';

/**
 * La empresa va en la URL por compatibilidad con el panel web, pero solo se
 * acepta la del propio usuario (la del token): un admin de una empresa no
 * puede leer ni cambiar la configuracion de nomina de otra.
 */
function assertOwnCompany(companyId: string, currentUser: AuthenticatedUser): void {
  if (companyId !== currentUser.companyId) {
    throw new ForbiddenException('No puedes ver ni cambiar la configuracion de otra empresa.');
  }
}

@Roles(UserRole.ADMIN)
@Controller('payroll-config')
export class PayrollConfigController {
  constructor(private readonly payrollConfigService: PayrollConfigService) {}

  @Get(':companyId/versions')
  listVersions(@Param('companyId') companyId: string, @CurrentUser() currentUser: AuthenticatedUser) {
    assertOwnCompany(companyId, currentUser);
    return this.payrollConfigService.listVersions(companyId);
  }

  @Post(':companyId/versions')
  createVersion(
    @Param('companyId') companyId: string,
    @Body() dto: CreatePayrollConfigVersionDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    assertOwnCompany(companyId, currentUser);
    return this.payrollConfigService.createVersion(companyId, dto);
  }

  @Put(':companyId/versions/:id')
  updateVersion(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @Body() dto: UpdatePayrollConfigVersionDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    assertOwnCompany(companyId, currentUser);
    return this.payrollConfigService.updateVersion(companyId, id, dto);
  }

  @Get(':companyId/settings')
  getSettings(@Param('companyId') companyId: string, @CurrentUser() currentUser: AuthenticatedUser) {
    assertOwnCompany(companyId, currentUser);
    return this.payrollConfigService.getOrCreateSettings(companyId);
  }

  @Put(':companyId/settings')
  updateSettings(
    @Param('companyId') companyId: string,
    @Body() dto: UpdatePayrollSettingsDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    assertOwnCompany(companyId, currentUser);
    return this.payrollConfigService.updateSettings(companyId, dto);
  }
}
