import { ArrayMinSize, IsArray, IsNumber, IsOptional, IsString, Min, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ScheduleDayDto } from './schedule-day.dto';

export class UpdateScheduleDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

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

  /** Si se envia, reemplaza los 7 dias existentes. */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(7)
  @ValidateNested({ each: true })
  @Type(() => ScheduleDayDto)
  days?: ScheduleDayDto[];
}
