import { IsDateString, IsOptional, IsUUID } from 'class-validator';

export class CalculateDailyNoveltiesDto {
  @IsUUID()
  userId!: string;

  @IsDateString()
  workDate!: string; // YYYY-MM-DD

  @IsOptional()
  @IsDateString()
  recalculateUntil?: string; // permite recalcular un rango [workDate, recalculateUntil]
}
