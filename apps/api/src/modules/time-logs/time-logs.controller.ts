import { Body, Controller, Delete, Get, Post, Put, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { TimeLogsService } from './time-logs.service';
import { MobileClockDto } from './dto/mobile-clock.dto';
import { ManualTimeLogDto } from './dto/manual-time-log.dto';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';

@Controller('time-logs')
export class TimeLogsController {
  constructor(private readonly timeLogsService: TimeLogsService) {}

  /** Modo Empleado: marca su propia entrada/salida validando GPS contra su sede asignada. */
  @Post('mobile-clock')
  mobileClock(@Body() dto: MobileClockDto, @CurrentUser() currentUser: AuthenticatedUser) {
    return this.timeLogsService.mobileClock(currentUser.id, dto);
  }

  /** Calculo manual de nomina: carga/reemplaza las marcas de un dia a partir de horas sueltas. */
  @Roles(UserRole.ADMIN, UserRole.HR, UserRole.SUPERVISOR)
  @Put('manual')
  upsertManual(@Body() dto: ManualTimeLogDto, @CurrentUser() currentUser: AuthenticatedUser) {
    return this.timeLogsService.upsertManualDay(currentUser.companyId, dto);
  }

  /** Borra todas las marcas de un dia especifico de un empleado (sin reemplazarlas) y recalcula sus novedades. */
  @Roles(UserRole.ADMIN, UserRole.HR, UserRole.SUPERVISOR)
  @Delete('manual')
  deleteManual(
    @Query('userId') userId: string,
    @Query('workDate') workDate: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.timeLogsService.deleteManualDay(currentUser.companyId, userId, workDate);
  }

  /** Trae marcas y novedades ya cargadas de un empleado en un rango, para precargar el formulario. */
  @Roles(UserRole.ADMIN, UserRole.HR, UserRole.SUPERVISOR)
  @Get('manual')
  getManualRange(
    @Query('userId') userId: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.timeLogsService.getManualRange(currentUser.companyId, userId, from, to);
  }

  /**
   * Historial de marcas con coordenadas y foto de evidencia. Sin @Roles: un
   * EMPLOYEE puede consultar el suyo propio (el service ignora cualquier
   * userId ajeno que llegue en la query); ADMIN/HR/SUPERVISOR pueden pedir el
   * de cualquier empleado de su empresa pasando userId.
   */
  @Get('history')
  getHistory(
    @Query('userId') userId: string | undefined,
    @Query('from') from: string,
    @Query('to') to: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.timeLogsService.getHistory(currentUser, userId, from, to);
  }
}
