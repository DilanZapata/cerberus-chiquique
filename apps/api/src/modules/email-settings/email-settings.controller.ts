import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { EmailSettingsService } from './email-settings.service';
import { UpsertEmailSettingsDto } from './dto/upsert-email-settings.dto';
import { Roles } from '../../common/decorators/roles.decorator';

@Roles(UserRole.ADMIN)
@Controller('email-settings')
export class EmailSettingsController {
  constructor(private readonly emailSettingsService: EmailSettingsService) {}

  @Get(':companyId')
  get(@Param('companyId') companyId: string) {
    return this.emailSettingsService.get(companyId);
  }

  @Put(':companyId')
  upsert(@Param('companyId') companyId: string, @Body() dto: UpsertEmailSettingsDto) {
    return this.emailSettingsService.upsert(companyId, dto);
  }
}
