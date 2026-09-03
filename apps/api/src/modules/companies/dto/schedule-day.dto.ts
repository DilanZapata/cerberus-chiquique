import { IsBoolean, IsEnum, IsInt, IsOptional, Matches, Min } from 'class-validator';
import { CycleWeek, DayOfWeek } from '@prisma/client';

export class ScheduleDayDto {
  @IsEnum(DayOfWeek)
  dayOfWeek!: DayOfWeek;

  /** Semana del ciclo (A o B). Se omite (o se envia 'A') para horarios WEEKLY de una sola semana. */
  @IsOptional()
  @IsEnum(CycleWeek)
  week?: CycleWeek;

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
