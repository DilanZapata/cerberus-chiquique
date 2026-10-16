import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { IncidencesService } from './incidences.service';
import { CreateIncidenceDto } from './dto/create-incidence.dto';
import { ReviewIncidenceDto } from './dto/review-incidence.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';

@Controller('incidences')
export class IncidencesController {
  constructor(private readonly incidencesService: IncidencesService) {}

  @Post()
  create(@CurrentUser() currentUser: AuthenticatedUser, @Body() dto: CreateIncidenceDto) {
    return this.incidencesService.create(currentUser.companyId, dto);
  }

  @Roles(UserRole.ADMIN, UserRole.HR, UserRole.SUPERVISOR)
  @Get('pending')
  listPending(@CurrentUser() currentUser: AuthenticatedUser, @Query('departmentId') departmentId?: string) {
    return this.incidencesService.listPending(currentUser.companyId, departmentId);
  }

  @Roles(UserRole.ADMIN, UserRole.HR, UserRole.SUPERVISOR)
  @Post(':id/review')
  review(
    @Param('id') id: string,
    @Body() dto: ReviewIncidenceDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.incidencesService.review(id, dto, currentUser.id, currentUser.companyId);
  }
}
