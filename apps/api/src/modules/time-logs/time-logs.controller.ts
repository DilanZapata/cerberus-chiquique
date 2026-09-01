import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { TimeLogsService } from './time-logs.service';
import { JornadaCierreService } from './jornada-cierre.service';
import { JornadasAbiertasService } from './jornadas-abiertas.service';
import { MobileClockDto } from './dto/mobile-clock.dto';
import { ManualTimeLogDto } from './dto/manual-time-log.dto';
import { CreateMarkDto, UpdateMarkDto } from './dto/single-mark.dto';
import { ReviewJornadaDto } from './dto/review-jornada.dto';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';

@Controller('time-logs')
export class TimeLogsController {
  constructor(
    private readonly timeLogsService: TimeLogsService,
    private readonly jornadaCierreService: JornadaCierreService,
    private readonly jornadasAbiertasService: JornadasAbiertasService,
  ) {}

  /** Dispara el cierre automatico de jornadas abiertas ya mismo, sin esperar el cron (para pruebas/soporte). */
  @Roles(UserRole.ADMIN)
  @Post('close-overdue-shifts')
  closeOverdueShifts() {
    return this.jornadaCierreService.closeOverdueOpenShifts();
  }

  /** Panel: jornadas abiertas vencidas o cerradas automaticamente que requieren revision de un supervisor. */
  @Roles(UserRole.ADMIN, UserRole.HR, UserRole.SUPERVISOR)
  @Get('jornadas-abiertas')
  listJornadasAbiertas(@Query('workDate') workDate: string | undefined, @CurrentUser() currentUser: AuthenticatedUser) {
    return this.jornadasAbiertasService.listNeedingAttention(currentUser.companyId, workDate);
  }

  /** Marca una jornada cerrada automaticamente como revisada. */
  @Roles(UserRole.ADMIN, UserRole.HR, UserRole.SUPERVISOR)
  @Post('jornadas-abiertas/:noveltyId/review')
  reviewJornada(
    @Param('noveltyId') noveltyId: string,
    @Body() dto: ReviewJornadaDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.jornadasAbiertasService.review(currentUser.companyId, noveltyId, dto, currentUser.id);
  }

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

  /** Agrega una marca puntual nueva (ej. el empleado olvido marcar la salida). */
  @Roles(UserRole.ADMIN, UserRole.HR, UserRole.SUPERVISOR)
  @Post('manual-mark')
  createMark(@Body() dto: CreateMarkDto, @CurrentUser() currentUser: AuthenticatedUser) {
    return this.timeLogsService.createMark(currentUser.companyId, dto);
  }

  /** Cuenta cuantas marcas/novedades se borrarian con este rango/empleado, sin borrar nada (para pedir confirmacion antes). */
  @Roles(UserRole.ADMIN)
  @Get('bulk')
  previewBulkDelete(
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('userId') userId: string | undefined,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.timeLogsService.previewBulkDelete(currentUser.companyId, from, to, userId);
  }

  /** Borra TODAS las marcas (y novedades/totales derivados) de un rango de fechas, de un empleado o de toda la empresa. Irreversible. */
  @Roles(UserRole.ADMIN)
  @Delete('bulk')
  bulkDelete(
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('userId') userId: string | undefined,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.timeLogsService.bulkDelete(currentUser.companyId, currentUser.id, from, to, userId);
  }

  // Rutas ":id" AL FINAL del controller a proposito: Nest/Express matchea en
  // orden de declaracion, y "PUT/DELETE /time-logs/:id" interceptaria rutas
  // literales como "/time-logs/manual" (con id="manual") si se declararan
  // antes que ellas.

  /** Cambia solo la hora de una marca puntual ya existente. */
  @Roles(UserRole.ADMIN, UserRole.HR, UserRole.SUPERVISOR)
  @Put(':id')
  updateMark(@Param('id') id: string, @Body() dto: UpdateMarkDto, @CurrentUser() currentUser: AuthenticatedUser) {
    return this.timeLogsService.updateMark(currentUser.companyId, id, dto.time);
  }

  /** Borra una marca puntual (no el dia completo). */
  @Roles(UserRole.ADMIN, UserRole.HR, UserRole.SUPERVISOR)
  @Delete(':id')
  deleteMark(@Param('id') id: string, @CurrentUser() currentUser: AuthenticatedUser) {
    return this.timeLogsService.deleteMark(currentUser.companyId, id);
  }
}
