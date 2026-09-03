import { ArrayMinSize, IsArray, IsEnum, IsNumber, IsOptional, IsString, Matches, Min, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ScheduleType } from '@prisma/client';
import { ScheduleDayDto } from './schedule-day.dto';

export class UpdateScheduleDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsEnum(ScheduleType)
  scheduleType?: ScheduleType;

  @IsOptional()
  @IsNumber()
  @Min(0)
  weeklyHoursTarget?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  defaultLunchMinutes?: number;

  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'lunchWindowStart debe tener formato HH:mm' })
  lunchWindowStart?: string;

  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'lunchWindowEnd debe tener formato HH:mm' })
  lunchWindowEnd?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  lunchToleranceMinutes?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  finalExitWindowBeforeMin?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  finalExitGraceMin?: number;

  /** Si se envia, reemplaza los 7 dias existentes. */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(7)
  @ValidateNested({ each: true })
  @Type(() => ScheduleDayDto)
  days?: ScheduleDayDto[];
}
