import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

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
}
