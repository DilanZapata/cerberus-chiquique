import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { NoveltiesService } from './novelties.service';
import { CalculateDailyNoveltiesDto } from './dto/calculate-daily-novelties.dto';
import { OvertimeApprovalService } from './services/overtime-approval.service';
import { ReviewNoveltyDto } from './dto/review-novelty.dto';
import { AuthorizeOvertimeDto } from './dto/authorize-overtime.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';

@Controller('novelties')
export class NoveltiesController {
  constructor(
    private readonly noveltiesService: NoveltiesService,
    private readonly overtimeApprovalService: OvertimeApprovalService,
  ) {}

  /** Dispara (o re-dispara) el calculo de novedades de un dia puntual para un empleado. */
  @Roles(UserRole.ADMIN, UserRole.HR, UserRole.SUPERVISOR)
  @Post('calculate')
  async calculate(@Body() dto: CalculateDailyNoveltiesDto, @CurrentUser() currentUser: AuthenticatedUser) {
    await this.noveltiesService.assertUserInCompany(dto.userId, currentUser.companyId);
    if (dto.recalculateUntil) {
      return this.noveltiesService.recalculateRange(dto.userId, dto.workDate, dto.recalculateUntil);
    }
    return this.noveltiesService.calculateAndPersistForDay(dto.userId, dto.workDate);
  }

  // ---- Horas extra ----
  // @Roles deja pasar a los tres roles administrativos; cuales de ellos
  // pueden de verdad autorizar lo decide la empresa (PayrollSettings.
  // overtimeApproverRoles), y lo valida OvertimeApprovalService en cada llamada.

  /** Si el usuario actual puede autorizar horas extra en su empresa (para que la app muestre u oculte esa parte). */
  @Roles(UserRole.ADMIN, UserRole.HR, UserRole.SUPERVISOR)
  @Get('overtime/permissions')
  overtimePermissions(@CurrentUser() currentUser: AuthenticatedUser) {
    return this.overtimeApprovalService.getPermissions(currentUser);
  }

  /** Panel de aprobacion: horas extra pendientes de decidir. */
  @Roles(UserRole.ADMIN, UserRole.HR, UserRole.SUPERVISOR)
  @Get('overtime/pending')
  listPendingOvertime(@CurrentUser() currentUser: AuthenticatedUser, @Query('departmentId') departmentId?: string) {
    return this.overtimeApprovalService.listPending(currentUser, departmentId);
  }

  @Roles(UserRole.ADMIN, UserRole.HR, UserRole.SUPERVISOR)
  @Post('overtime/:id/review')
  reviewOvertime(
    @Param('id') overtimeApprovalId: string,
    @Body() dto: ReviewNoveltyDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.overtimeApprovalService.review(overtimeApprovalId, dto, currentUser);
  }

  /** Autoriza N horas extra a una persona para un dia (antes o despues de trabajarlas). */
  @Roles(UserRole.ADMIN, UserRole.HR, UserRole.SUPERVISOR)
  @Post('overtime/authorizations')
  authorizeOvertime(@Body() dto: AuthorizeOvertimeDto, @CurrentUser() currentUser: AuthenticatedUser) {
    return this.overtimeApprovalService.authorize(currentUser, dto);
  }

  /** Autorizaciones dadas en un rango, con lo que realmente se trabajo cada dia. */
  @Roles(UserRole.ADMIN, UserRole.HR, UserRole.SUPERVISOR)
  @Get('overtime/authorizations')
  listOvertimeAuthorizations(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.overtimeApprovalService.listAuthorizations(currentUser, from, to);
  }
}
