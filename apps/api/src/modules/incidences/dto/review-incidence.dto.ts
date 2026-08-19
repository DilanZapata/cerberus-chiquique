import { IsEnum, IsOptional, IsString } from 'class-validator';
import { NoveltyStatus } from '@cerberus/shared-types';

export class ReviewIncidenceDto {
  @IsEnum(NoveltyStatus)
  status!: NoveltyStatus.APROBADA | NoveltyStatus.RECHAZADA;

  @IsOptional()
  @IsString()
  notes?: string;
}
