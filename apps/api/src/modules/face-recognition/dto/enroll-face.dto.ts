import { IsString, IsUUID, MinLength } from 'class-validator';

export class EnrollFaceDto {
  @IsUUID()
  userId!: string;

  /** Foto de enrolamiento en base64 (data URL o base64 crudo). */
  @IsString()
  imageBase64!: string;

  /** Texto exacto de consentimiento que el empleado acepto (queda como evidencia). */
  @IsString()
  @MinLength(20)
  consentText!: string;
}
