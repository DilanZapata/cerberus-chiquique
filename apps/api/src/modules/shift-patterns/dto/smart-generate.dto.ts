import { ArrayMinSize, IsArray, IsDateString, IsInt, IsOptional, IsString, IsUUID, Matches, Max, Min } from 'class-validator';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export class SmartGenerateShiftPatternDto {
  @IsString()
  name!: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  workerIds!: string[];

  @Matches(HHMM)
  coverageStart!: string;

  @Matches(HHMM)
  coverageEnd!: string;

  @IsInt()
  @Min(1)
  @Max(24)
  shiftHours!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(28)
  cycleLengthDays?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(6)
  restDaysPerWeek?: number;

  @IsDateString()
  anchorDate!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(26)
  horizonWeeks?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  lunchMinutes?: number;
}
