import { ArrayMinSize, IsArray, IsNumber, IsOptional, IsString, Min, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ScheduleDayDto } from './schedule-day.dto';

export class CreateScheduleDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  weeklyHoursTarget?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  defaultLunchMinutes?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  lunchToleranceMinutes?: number;

  /** Los 7 dias de la semana (uno por DayOfWeek). */
  @IsArray()
  @ArrayMinSize(7)
  @ValidateNested({ each: true })
  @Type(() => ScheduleDayDto)
  days!: ScheduleDayDto[];
}
