import { ArrayMinSize, IsArray, IsNumber, IsOptional, IsString, Matches, Min, MinLength, ValidateNested } from 'class-validator';
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

  /** Formato "HH:mm". Desde que hora se puede marcar la salida a almorzar. */
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'lunchWindowStart debe tener formato HH:mm' })
  lunchWindowStart?: string;

  /** Formato "HH:mm". Hasta que hora se puede marcar el regreso de almuerzo. */
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'lunchWindowEnd debe tener formato HH:mm' })
  lunchWindowEnd?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  lunchToleranceMinutes?: number;

  /** Desde cuantos minutos antes de la salida programada, una marca siempre se interpreta como salida final. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  finalExitWindowBeforeMin?: number;

  /** Margen (minutos) tras la salida programada antes de considerar la jornada vencida para cierre automatico. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  finalExitGraceMin?: number;

  /** Los 7 dias de la semana (uno por DayOfWeek). */
  @IsArray()
  @ArrayMinSize(7)
  @ValidateNested({ each: true })
  @Type(() => ScheduleDayDto)
  days!: ScheduleDayDto[];
}
