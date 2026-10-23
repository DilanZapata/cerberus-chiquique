import { IsLatitude, IsLongitude, IsOptional, IsString, MinLength } from 'class-validator';

export class KioskClockDto {
  /** Ubicacion actual del dispositivo kiosco; identifica la sede (y la empresa) por proximidad GPS. */
  @IsLatitude()
  latitude!: number;

  @IsLongitude()
  longitude!: number;

  /** Cedula, codigo de empleado, O PIN -- cualquiera de los tres identifica (ver KioskService.identifyByCodeOrPin). */
  @IsString()
  @MinLength(1)
  identifier!: string;

  /** Foto de evidencia tomada al momento de marcar (opcional, base64). */
  @IsOptional()
  @IsString()
  imageBase64?: string;
}
