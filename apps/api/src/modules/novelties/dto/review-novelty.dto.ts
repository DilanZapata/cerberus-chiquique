import { IsEnum, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { NoveltyStatus } from '@cerberus/shared-types';

export class ReviewNoveltyDto {
  @IsEnum(NoveltyStatus)
  status!: NoveltyStatus.APROBADA | NoveltyStatus.RECHAZADA;

  /** Horas efectivamente aprobadas (puede ser menor a las solicitadas). Solo aplica si status = APROBADA. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  approvedHours?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
