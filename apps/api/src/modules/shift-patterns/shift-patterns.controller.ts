import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { ShiftPatternsService } from './shift-patterns.service';
import { CreateShiftPatternDto } from './dto/create-shift-pattern.dto';
import { AssignPatternToTeamDto, AssignPatternToUserDto } from './dto/assign-pattern.dto';
import { GenerateShiftsDto } from './dto/generate-shifts.dto';
import { SmartGenerateShiftPatternDto } from './dto/smart-generate.dto';
import { SmartGenerateMilkingDto } from './dto/smart-generate-milking.dto';
import { Roles } from '../../common/decorators/roles.decorator';

@Roles(UserRole.ADMIN, UserRole.HR)
@Controller('shift-patterns')
export class ShiftPatternsController {
  constructor(private readonly shiftPatternsService: ShiftPatternsService) {}

  @Get()
  list(@Query('companyId') companyId: string) {
    return this.shiftPatternsService.listPatterns(companyId);
  }

  @Post()
  create(@Query('companyId') companyId: string, @Body() dto: CreateShiftPatternDto) {
    return this.shiftPatternsService.createPattern(companyId, dto);
  }

  @Post(':id/assign-team')
  assignTeam(@Param('id') patternId: string, @Body() dto: AssignPatternToTeamDto) {
    return this.shiftPatternsService.assignToTeam(patternId, dto);
  }

  @Post(':id/assign-user')
  assignUser(@Param('id') patternId: string, @Body() dto: AssignPatternToUserDto) {
    return this.shiftPatternsService.assignToUser(patternId, dto);
  }

  @Post('smart-generate')
  smartGenerate(@Query('companyId') companyId: string, @Body() dto: SmartGenerateShiftPatternDto) {
    return this.shiftPatternsService.smartGenerate(companyId, dto);
  }

  @Post('smart-generate-milking')
  smartGenerateMilking(@Query('companyId') companyId: string, @Body() dto: SmartGenerateMilkingDto) {
    return this.shiftPatternsService.smartGenerateMilking(companyId, dto);
  }

  @Post('generate')
  async generate(@Body() dto: GenerateShiftsDto) {
    const from = new Date(`${dto.from}T00:00:00`);
    const to = new Date(`${dto.to}T00:00:00`);
    const generated = dto.departmentId
      ? await this.shiftPatternsService.generateShiftsForDepartment(dto.departmentId, from, to)
      : await this.shiftPatternsService.generateShiftsForUser(dto.userId as string, from, to);
    return { generated };
  }
}
