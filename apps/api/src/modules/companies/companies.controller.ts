import { BadRequestException, Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { CycleWeek, UserRole } from '@prisma/client';
import { CompaniesService } from './companies.service';
import { UpdateCompanyDto } from './dto/update-company.dto';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { CreateWorkSiteDto } from './dto/create-work-site.dto';
import { UpdateWorkSiteDto } from './dto/update-work-site.dto';
import { CreateScheduleDto } from './dto/create-schedule.dto';
import { UpdateScheduleDto } from './dto/update-schedule.dto';
import { CreatePositionDto } from './dto/create-position.dto';
import { UpdatePositionDto } from './dto/update-position.dto';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';

@Controller('companies')
export class CompaniesController {
  constructor(private readonly companiesService: CompaniesService) {}

  @Get('me')
  getMine(@CurrentUser() user: AuthenticatedUser) {
    return this.companiesService.getById(user.companyId);
  }

  @Roles(UserRole.ADMIN)
  @Put('me')
  updateMine(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateCompanyDto) {
    return this.companiesService.update(user.companyId, dto);
  }

  @Get('me/departments')
  listDepartments(@CurrentUser() user: AuthenticatedUser) {
    return this.companiesService.listDepartments(user.companyId);
  }

  @Roles(UserRole.ADMIN, UserRole.HR)
  @Post('me/departments')
  createDepartment(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateDepartmentDto) {
    return this.companiesService.createDepartment(user.companyId, dto);
  }

  @Get('me/work-sites')
  listWorkSites(@CurrentUser() user: AuthenticatedUser) {
    return this.companiesService.listWorkSites(user.companyId);
  }

  @Roles(UserRole.ADMIN, UserRole.HR)
  @Post('me/work-sites')
  createWorkSite(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateWorkSiteDto) {
    return this.companiesService.createWorkSite(user.companyId, dto);
  }

  @Roles(UserRole.ADMIN, UserRole.HR)
  @Put('me/work-sites/:id')
  updateWorkSite(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateWorkSiteDto) {
    return this.companiesService.updateWorkSite(user.companyId, id, dto);
  }

  @Get('me/schedules')
  listSchedules(@CurrentUser() user: AuthenticatedUser) {
    return this.companiesService.listSchedules(user.companyId);
  }

  /**
   * Vista previa PURA de como alterna un ciclo Semana A/Semana B para un
   * ancla+semana inicial dados, sin depender de que exista ya un Schedule ni
   * un empleado -- util en el formulario de alta/edicion de empleado para
   * mostrar el resultado antes de guardar nada.
   */
  @Get('me/schedules/cycle-preview')
  previewCycleWeeks(@Query('anchorDate') anchorDate?: string, @Query('startWeek') startWeek?: string, @Query('weeks') weeks?: string) {
    if (!anchorDate || !startWeek) throw new BadRequestException('anchorDate y startWeek son obligatorios.');
    if (startWeek !== CycleWeek.A && startWeek !== CycleWeek.B) throw new BadRequestException('startWeek debe ser "A" o "B".');
    const weekCount = weeks ? Number(weeks) : 4;
    if (!Number.isInteger(weekCount) || weekCount < 1 || weekCount > 12) {
      throw new BadRequestException('weeks debe ser un entero entre 1 y 12.');
    }
    return this.companiesService.previewCycleWeeks(new Date(`${anchorDate}T00:00:00`), startWeek, weekCount);
  }

  @Roles(UserRole.ADMIN, UserRole.HR)
  @Post('me/schedules')
  createSchedule(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateScheduleDto) {
    return this.companiesService.createSchedule(user.companyId, dto);
  }

  @Roles(UserRole.ADMIN, UserRole.HR)
  @Put('me/schedules/:id')
  updateSchedule(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateScheduleDto) {
    return this.companiesService.updateSchedule(user.companyId, id, dto);
  }

  @Get('me/positions')
  listPositions(@CurrentUser() user: AuthenticatedUser) {
    return this.companiesService.listPositions(user.companyId);
  }

  @Roles(UserRole.ADMIN, UserRole.HR)
  @Post('me/positions')
  createPosition(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreatePositionDto) {
    return this.companiesService.createPosition(user.companyId, dto);
  }

  @Roles(UserRole.ADMIN, UserRole.HR)
  @Put('me/positions/:id')
  updatePosition(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdatePositionDto) {
    return this.companiesService.updatePosition(user.companyId, id, dto);
  }
}
