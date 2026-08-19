import { IsDateString, IsEnum, IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';
import { NoveltyCode } from '@cerberus/shared-types';

const ALLOWED_CODES = [
  NoveltyCode.PERMISO_REMUNERADO,
  NoveltyCode.PERMISO_NO_REMUNERADO,
  NoveltyCode.PERMISO_SALIDA_TEMPORAL,
  NoveltyCode.INCAPACIDAD_GENERAL,
  NoveltyCode.INCAPACIDAD_ARL,
  NoveltyCode.VACACIONES,
] as const;

export class CreateIncidenceDto {
  @IsUUID()
  userId!: string;

  @IsEnum(ALLOWED_CODES)
  code!: (typeof ALLOWED_CODES)[number];

  @IsDateString()
  startDate!: string;

  @IsDateString()
  endDate!: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  hoursPerDay?: number;

  @IsOptional()
  @IsString()
  supportingDocUrl?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
