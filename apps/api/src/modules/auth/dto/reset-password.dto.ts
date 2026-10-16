import { IsEmail, IsString, Length, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @IsEmail()
  email!: string;

  /** Codigo de 6 digitos enviado al correo. */
  @IsString()
  @Length(6, 6)
  code!: string;

  @IsString()
  @MinLength(4)
  newPassword!: string;
}
