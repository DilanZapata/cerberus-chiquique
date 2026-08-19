import { IsDateString, IsInt, IsOptional, IsUUID, Min } from 'class-validator';

export class AssignPatternToTeamDto {
  @IsUUID()
  departmentId!: string;

  @IsDateString()
  anchorDate!: string;

  /** Desfasa el ancla por integrante (indice en el equipo * staggerDays), para que no roten todos el mismo dia. */
  @IsOptional()
  @IsInt()
  @Min(0)
  staggerDays?: number;

  @IsOptional()
  @IsDateString()
  validFrom?: string;
}

export class AssignPatternToUserDto {
  @IsUUID()
  userId!: string;

  @IsDateString()
  anchorDate!: string;

  @IsOptional()
  @IsDateString()
  validFrom?: string;

  @IsOptional()
  @IsDateString()
  validTo?: string;
}
