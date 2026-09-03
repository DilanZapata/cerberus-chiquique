import { IsDateString, IsEnum, IsOptional, IsUUID, ValidateIf } from 'class-validator';
import { CycleWeek } from '@prisma/client';

/**
 * Reasigna el horario individual (UserSchedule) de un empleado, versionado:
 * cierra la asignacion activa y abre una nueva a partir de `effectiveFrom`,
 * preservando el historial para fechas anteriores. `scheduleId: null` quita
 * el horario individual (el empleado vuelve a usar el de su cargo, si tiene).
 */
export class UpdateUserScheduleDto {
  @ValidateIf((o) => o.scheduleId !== null)
  @IsUUID()
  scheduleId!: string | null;

  /** "AAAA-MM-DD". Si se omite, hoy. */
  @IsOptional()
  @IsDateString()
  effectiveFrom?: string;

  /** Obligatoria (validado en el service) si el horario elegido es rotativo (Semana A/B). */
  @IsOptional()
  @IsDateString()
  cycleAnchorDate?: string;

  /** Obligatoria (validado en el service) si el horario elegido es rotativo (Semana A/B). */
  @IsOptional()
  @IsEnum(CycleWeek)
  cycleStartWeek?: CycleWeek;
}
