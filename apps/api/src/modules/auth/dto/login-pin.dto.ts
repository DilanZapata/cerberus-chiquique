import { IsString, Matches } from 'class-validator';

/** Ingreso con cedula + PIN (app Cerberus Managers). */
export class LoginPinDto {
  @IsString()
  @Matches(/^[0-9A-Za-z.-]{4,20}$/, { message: 'La cedula no es valida.' })
  nationalId!: string;

  @IsString()
  @Matches(/^[0-9]{4,8}$/, { message: 'El PIN son de 4 a 8 numeros.' })
  pin!: string;
}
