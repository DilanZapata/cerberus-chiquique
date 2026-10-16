import { Controller, Get, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { DashboardService } from './dashboard.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Roles(UserRole.ADMIN, UserRole.HR, UserRole.SUPERVISOR)
  @Get('attendance')
  getAttendance(@CurrentUser() user: AuthenticatedUser, @Query('date') date: string) {
    return this.dashboardService.getAttendanceForDate(user.companyId, date);
  }
}
