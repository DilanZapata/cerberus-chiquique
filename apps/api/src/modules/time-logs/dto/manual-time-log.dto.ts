import { IsDateString, IsOptional, IsUUID, Matches } from 'class-validator';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export class ManualTimeLogDto {
  @IsUUID()
  userId!: string;

  @IsDateString()
  workDate!: string;

  @IsOptional()
  @Matches(HHMM, { message: 'checkIn debe tener formato HH:mm' })
  checkIn?: string;

  @IsOptional()
  @Matches(HHMM, { message: 'lunchOut debe tener formato HH:mm' })
  lunchOut?: string;

  @IsOptional()
  @Matches(HHMM, { message: 'lunchIn debe tener formato HH:mm' })
  lunchIn?: string;

  @IsOptional()
  @Matches(HHMM, { message: 'checkOut debe tener formato HH:mm' })
  checkOut?: string;
}
