import { Controller, Get, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { DashboardService } from './dashboard.service';
import { Roles } from '../../common/decorators/roles.decorator';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Roles(UserRole.ADMIN, UserRole.HR, UserRole.SUPERVISOR)
  @Get('attendance')
  getAttendance(@Query('date') date: string) {
    return this.dashboardService.getAttendanceForDate(date);
  }
}
