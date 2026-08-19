import { IsLatitude, IsLongitude, IsOptional, IsString, Matches } from 'class-validator';

export class KioskClockDto {
  /** Ubicacion actual del dispositivo kiosco; identifica la sede (y la empresa) por proximidad GPS. */
  @IsLatitude()
  latitude!: number;

  @IsLongitude()
  longitude!: number;

  @IsString()
  employeeCode!: string;

  @Matches(/^\d{4,6}$/, { message: 'El PIN debe tener entre 4 y 6 digitos' })
  pin!: string;

  /** Foto de evidencia tomada al momento de marcar (opcional, base64). */
  @IsOptional()
  @IsString()
  imageBase64?: string;
}
