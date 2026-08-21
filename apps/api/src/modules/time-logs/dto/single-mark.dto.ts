import { IsDateString, IsEnum, IsUUID, Matches } from 'class-validator';
import { TimeLogType } from '@prisma/client';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export class UpdateMarkDto {
  @Matches(HHMM, { message: 'time debe tener formato HH:mm' })
  time!: string;
}

export class CreateMarkDto {
  @IsUUID()
  userId!: string;

  @IsDateString()
  workDate!: string;

  @IsEnum(TimeLogType)
  logType!: TimeLogType;

  @Matches(HHMM, { message: 'time debe tener formato HH:mm' })
  time!: string;
}
