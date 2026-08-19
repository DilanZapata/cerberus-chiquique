import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { RestCreditsService } from './rest-credits.service';
import { TakeRestCreditDto } from './dto/take-rest-credit.dto';
import { Roles } from '../../common/decorators/roles.decorator';

@Roles(UserRole.ADMIN, UserRole.HR, UserRole.SUPERVISOR)
@Controller('rest-credits')
export class RestCreditsController {
  constructor(private readonly restCreditsService: RestCreditsService) {}

  @Get('pending')
  listPending(@Query('departmentId') departmentId?: string) {
    return this.restCreditsService.listPending(departmentId);
  }

  @Post(':id/take')
  take(@Param('id') id: string, @Body() dto: TakeRestCreditDto) {
    return this.restCreditsService.take(id, dto);
  }
}
