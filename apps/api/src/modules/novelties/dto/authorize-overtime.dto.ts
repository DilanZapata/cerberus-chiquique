import { IsDateString, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

/** "A este empleado, este dia, le autorizo N horas extra." */
export class AuthorizeOvertimeDto {
  @IsUUID()
  userId!: string;

  /** Dia para el que se autoriza (YYYY-MM-DD): hoy, un dia futuro o uno pasado. */
  @IsDateString()
  workDate!: string;

  /** Horas autorizadas, en pasos de media hora. 0 retira la autorizacion. */
  @IsNumber()
  @Min(0)
  @Max(16)
  hours!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
