import { IsLatitude, IsLongitude, IsOptional, IsString } from 'class-validator';

export class MobileClockDto {
  @IsLatitude()
  latitude!: number;

  @IsLongitude()
  longitude!: number;

  /** Foto de evidencia tomada al momento de marcar (opcional, base64). */
  @IsOptional()
  @IsString()
  imageBase64?: string;
}
