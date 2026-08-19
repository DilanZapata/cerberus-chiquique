import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';
import { ShiftRotation } from '@prisma/client';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export class ShiftPatternDayDto {
  @IsInt()
  @Min(0)
  dayOffset!: number;

  @IsBoolean()
  isRestDay!: boolean;

  @IsEnum(ShiftRotation)
  rotationType!: ShiftRotation;

  @IsOptional()
  @Matches(HHMM)
  startTime?: string;

  @IsOptional()
  @Matches(HHMM)
  endTime?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  lunchMinutes?: number;
}

export class CreateShiftPatternDto {
  @IsString()
  name!: string;

  @IsInt()
  @Min(1)
  cycleLengthDays!: number;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ShiftPatternDayDto)
  days!: ShiftPatternDayDto[];
}
