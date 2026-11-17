import { Body, Controller, ForbiddenException, Get, Param, Put } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { EmailSettingsService } from './email-settings.service';
import { UpsertEmailSettingsDto } from './dto/upsert-email-settings.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';

/**
 * El `:companyId` de la URL se conserva por compatibilidad con el cliente
 * web, pero SIEMPRE debe coincidir con la empresa del JWT: antes se usaba
 * tal cual, asi que el ADMIN de una empresa podia leer o sobrescribir el
 * SMTP de otra (y con eso desviar sus correos, incluido el codigo de
 * restablecer contrasena).
 */
@Roles(UserRole.ADMIN)
@Controller('email-settings')
export class EmailSettingsController {
  constructor(private readonly emailSettingsService: EmailSettingsService) {}

  private assertOwnCompany(user: AuthenticatedUser, companyId: string) {
    if (companyId !== user.companyId) {
      throw new ForbiddenException('Solo puedes consultar o cambiar el correo de tu propia empresa.');
    }
  }

  @Get(':companyId')
  get(@CurrentUser() user: AuthenticatedUser, @Param('companyId') companyId: string) {
    this.assertOwnCompany(user, companyId);
    return this.emailSettingsService.get(companyId);
  }

  @Put(':companyId')
  upsert(@CurrentUser() user: AuthenticatedUser, @Param('companyId') companyId: string, @Body() dto: UpsertEmailSettingsDto) {
    this.assertOwnCompany(user, companyId);
    return this.emailSettingsService.upsert(companyId, dto);
  }
}
