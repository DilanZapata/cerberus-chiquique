import { IsBoolean, IsEnum, IsInt, IsOptional, Matches, Min } from 'class-validator';
import { DayOfWeek } from '@prisma/client';

export class ScheduleDayDto {
  @IsEnum(DayOfWeek)
  dayOfWeek!: DayOfWeek;

  @IsBoolean()
  isWorkingDay!: boolean;

  /** Formato "HH:mm". Requerido si isWorkingDay es true. */
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'startTime debe tener formato HH:mm' })
  startTime?: string;

  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'endTime debe tener formato HH:mm' })
  endTime?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  lunchMinutes?: number;
}
