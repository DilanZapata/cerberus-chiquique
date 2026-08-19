import { IsDateString, IsInt, IsNumber, IsOptional, IsString, Matches, Min } from 'class-validator';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export class CreatePayrollConfigVersionDto {
  @IsDateString()
  effectiveFrom!: string;

  @Matches(HHMM)
  dayStartTime!: string;

  @Matches(HHMM)
  nightStartTime!: string;

  @IsNumber()
  @Min(1)
  maxWeeklyHours!: number;

  @IsNumber()
  @Min(1)
  maxDailyOrdinaryHours!: number;

  @IsNumber()
  @Min(0)
  maxDailyOvertimeHours!: number;

  @IsNumber()
  @Min(0)
  maxWeeklyOvertimeHours!: number;

  @IsInt()
  @Min(0)
  dominicalOcasionalMaxPerMonth!: number;

  @IsNumber() pctRecargoNocturno!: number;
  @IsNumber() pctDominicalFestivo!: number;
  @IsNumber() pctDominicalFestivoNocturno!: number;
  @IsNumber() pctHoraExtraDiurna!: number;
  @IsNumber() pctHoraExtraNocturna!: number;
  @IsNumber() pctHoraExtraFestivaDiurna!: number;
  @IsNumber() pctHoraExtraFestivaNocturna!: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
