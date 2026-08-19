import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { NoveltiesService } from './novelties.service';
import { CalculateDailyNoveltiesDto } from './dto/calculate-daily-novelties.dto';
import { OvertimeApprovalService } from './services/overtime-approval.service';
import { ReviewNoveltyDto } from './dto/review-novelty.dto';
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
  calculate(@Body() dto: CalculateDailyNoveltiesDto) {
    if (dto.recalculateUntil) {
      return this.noveltiesService.recalculateRange(dto.userId, dto.workDate, dto.recalculateUntil);
    }
    return this.noveltiesService.calculateAndPersistForDay(dto.userId, dto.workDate);
  }

  /** Panel de aprobacion: lista horas extra pendientes de autorizacion. */
  @Roles(UserRole.ADMIN, UserRole.HR, UserRole.SUPERVISOR)
  @Get('overtime/pending')
  listPendingOvertime(@Query('departmentId') departmentId?: string) {
    return this.overtimeApprovalService.listPending(departmentId);
  }

  @Roles(UserRole.ADMIN, UserRole.HR, UserRole.SUPERVISOR)
  @Post('overtime/:id/review')
  reviewOvertime(
    @Param('id') overtimeApprovalId: string,
    @Body() dto: ReviewNoveltyDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.overtimeApprovalService.review(overtimeApprovalId, dto, currentUser.id);
  }
}
