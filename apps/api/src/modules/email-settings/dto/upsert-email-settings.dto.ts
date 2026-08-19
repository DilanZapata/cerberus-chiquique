import { IsArray, IsBoolean, IsEmail, IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { SmtpSecurity } from '@prisma/client';

export class UpsertEmailSettingsDto {
  @IsString()
  smtpHost!: string;

  @IsInt()
  @Min(1)
  smtpPort!: number;

  @IsString()
  smtpUser!: string;

  /** Contrasena / clave de aplicacion en texto plano; el backend la cifra antes de guardarla. */
  @IsString()
  smtpPassword!: string;

  @IsEnum(SmtpSecurity)
  smtpSecurity!: SmtpSecurity;

  @IsString()
  fromName!: string;

  @IsEmail()
  fromEmail!: string;

  @IsArray()
  @IsEmail({}, { each: true })
  adminRecipients!: string[];

  @IsOptional()
  @IsBoolean()
  weeklyAlertEnabled?: boolean;
}
