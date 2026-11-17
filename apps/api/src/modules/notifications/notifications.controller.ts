import { BadRequestException, Controller, ForbiddenException, Param, Post, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { WeeklyAlertService } from './weekly-alert.service';
import { AttendanceAlertService } from './attendance-alert.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';

@Roles(UserRole.ADMIN)
@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly weeklyAlertService: WeeklyAlertService,
    private readonly attendanceAlertService: AttendanceAlertService,
  ) {}

  /** Dispara el resumen de novedades pendientes ya mismo, sin esperar el cron diario. */
  @Post('send-weekly-summary/:companyId')
  send(@CurrentUser() user: AuthenticatedUser, @Param('companyId') companyId: string) {
    // El :companyId de la URL debe ser la empresa del JWT (no se confia en el cliente).
    if (companyId !== user.companyId) throw new ForbiddenException('Solo puedes enviar el resumen de tu propia empresa.');
    return this.weeklyAlertService.sendSummaryForCompany(companyId);
  }

  /**
   * Cierre diario manual (el automatico corre solo a las 00:30 sobre el dia
   * anterior): calcula los dias sin marcas -- generando las ausencias -- de
   * `from` a `to` (o solo `from`). Sirve para poner al dia fechas pasadas.
   * Nunca toca dias ya calculados ni el dia de hoy.
   */
  @Post('daily-close')
  dailyClose(@CurrentUser() user: AuthenticatedUser, @Query('from') from: string, @Query('to') to?: string) {
    const isDate = (v?: string) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00`));
    if (!isDate(from) || (to !== undefined && !isDate(to))) {
      throw new BadRequestException('"from" (y "to", si se envia) deben ser fechas validas (YYYY-MM-DD).');
    }
    return this.attendanceAlertService.closeRange(user.companyId, from, to ?? from);
  }

  /** Reenvia el resumen diario de asistencia de una fecha. */
  @Post('daily-summary')
  dailySummary(@CurrentUser() user: AuthenticatedUser, @Query('date') date: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) throw new BadRequestException('"date" debe ser una fecha valida (YYYY-MM-DD).');
    return this.attendanceAlertService.sendDailySummary(user.companyId, date);
  }
}
