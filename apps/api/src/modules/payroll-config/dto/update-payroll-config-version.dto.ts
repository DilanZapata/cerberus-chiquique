import { IsDateString, IsInt, IsNumber, IsOptional, IsString, Matches, Min } from 'class-validator';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export class UpdatePayrollConfigVersionDto {
  @IsOptional()
  @IsDateString()
  effectiveFrom?: string;

  @IsOptional()
  @Matches(HHMM)
  dayStartTime?: string;

  @IsOptional()
  @Matches(HHMM)
  nightStartTime?: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  maxWeeklyHours?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  maxDailyOrdinaryHours?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  maxDailyOvertimeHours?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  maxWeeklyOvertimeHours?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  dominicalOcasionalMaxPerMonth?: number;

  @IsOptional() @IsNumber() pctRecargoNocturno?: number;
  @IsOptional() @IsNumber() pctDominicalFestivo?: number;
  @IsOptional() @IsNumber() pctDominicalFestivoNocturno?: number;
  @IsOptional() @IsNumber() pctHoraExtraDiurna?: number;
  @IsOptional() @IsNumber() pctHoraExtraNocturna?: number;
  @IsOptional() @IsNumber() pctHoraExtraFestivaDiurna?: number;
  @IsOptional() @IsNumber() pctHoraExtraFestivaNocturna?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
