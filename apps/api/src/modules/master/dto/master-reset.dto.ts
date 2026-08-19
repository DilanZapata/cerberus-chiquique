import { IsString } from 'class-validator';

export class MasterResetDto {
  /** Debe coincidir exactamente con esta frase para confirmar el borrado. */
  @IsString()
  confirmationPhrase!: string;
}
