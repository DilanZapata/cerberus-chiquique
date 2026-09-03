import { BadRequestException, Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateUserScheduleDto } from './dto/update-user-schedule.dto';
import { NoveltiesService } from '../novelties/novelties.service';
import { addDays } from '../../common/utils/time.util';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';

const SCHEDULE_PREVIEW_MAX_DAYS = 60;

@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly noveltiesService: NoveltiesService,
  ) {}

  @Roles(UserRole.ADMIN, UserRole.HR, UserRole.SUPERVISOR)
  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.usersService.list(user.companyId);
  }

  @Roles(UserRole.ADMIN, UserRole.HR, UserRole.SUPERVISOR)
  @Get(':id')
  getOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.usersService.getOrThrow(user.companyId, id);
  }

  @Roles(UserRole.ADMIN, UserRole.HR)
  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateUserDto) {
    return this.usersService.create(user.companyId, dto);
  }

  @Roles(UserRole.ADMIN, UserRole.HR)
  @Put(':id')
  update(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.usersService.update(user.companyId, id, dto);
  }

  @Roles(UserRole.ADMIN, UserRole.HR)
  @Post(':id/deactivate')
  deactivate(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.usersService.deactivate(user.companyId, id);
  }

  /**
   * "obtenerHorarioEmpleadoParaFecha" expuesto para la UI: vista previa del
   * horario resuelto (incluida la semana A/B del ciclo, si aplica) para un
   * rango de fechas. Sin `to`, devuelve solo `from` (o hoy). Util al
   * configurar el ancla de un horario rotativo, para confirmar visualmente
   * como alterna antes de guardar.
   */
  @Roles(UserRole.ADMIN, UserRole.HR, UserRole.SUPERVISOR)
  @Get(':id/schedule')
  async getSchedulePreview(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    await this.usersService.getOrThrow(user.companyId, id);

    const fromDate = new Date(`${from ?? new Date().toISOString().slice(0, 10)}T00:00:00`);
    const toDate = to ? new Date(`${to}T00:00:00`) : fromDate;
    if (toDate < fromDate) throw new BadRequestException('"to" no puede ser anterior a "from".');
    const rangeDays = Math.round((toDate.getTime() - fromDate.getTime()) / 86_400_000) + 1;
    if (rangeDays > SCHEDULE_PREVIEW_MAX_DAYS) {
      throw new BadRequestException(`El rango no puede superar ${SCHEDULE_PREVIEW_MAX_DAYS} dias.`);
    }

    const days: { date: string; info: Awaited<ReturnType<NoveltiesService['getScheduleInfoForDate']>> }[] = [];
    for (let day = fromDate; day <= toDate; day = addDays(day, 1)) {
      days.push({ date: day.toISOString().slice(0, 10), info: await this.noveltiesService.getScheduleInfoForDate(id, day) });
    }
    return days;
  }

  @Roles(UserRole.ADMIN, UserRole.HR)
  @Put(':id/schedule')
  updateSchedule(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateUserScheduleDto) {
    return this.usersService.updateSchedule(user.companyId, id, dto);
  }
}
