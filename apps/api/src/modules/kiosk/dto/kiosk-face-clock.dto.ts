import { IsLatitude, IsLongitude, IsString } from 'class-validator';

export class KioskFaceClockDto {
  /** Ubicacion actual del dispositivo kiosco; identifica la sede (y la empresa) por proximidad GPS. */
  @IsLatitude()
  latitude!: number;

  @IsLongitude()
  longitude!: number;

  /** Foto tomada en el kiosco/celular en base64 (data URL o base64 crudo). */
  @IsString()
  imageBase64!: string;
}
