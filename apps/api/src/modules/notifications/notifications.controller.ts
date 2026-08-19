import { Controller, Param, Post } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { WeeklyAlertService } from './weekly-alert.service';
import { Roles } from '../../common/decorators/roles.decorator';

@Roles(UserRole.ADMIN)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly weeklyAlertService: WeeklyAlertService) {}

  /** Dispara el resumen de novedades pendientes ya mismo, sin esperar el cron diario. */
  @Post('send-weekly-summary/:companyId')
  send(@Param('companyId') companyId: string) {
    return this.weeklyAlertService.sendSummaryForCompany(companyId);
  }
}
