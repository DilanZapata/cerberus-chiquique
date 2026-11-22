import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export const MILKING_ROSTER_ROLES = ['ORDENADOR', 'RELEVO', 'VAQUERO', 'COMODIN'] as const;

export class MilkingRosterWorkerDto {
  @IsUUID()
  userId!: string;

  /** ORDENADOR (fijo en su ordeño), RELEVO (cruza cuando falta gente), VAQUERO (fijo en su vaqueria) o COMODIN. */
  @IsIn(MILKING_ROSTER_ROLES)
  role!: (typeof MILKING_ROSTER_ROLES)[number];

  /** Ordeño base, empezando en 0 (0 = Ordeño 1). No aplica al comodin. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(9)
  homeStation?: number;

  /** Dia del ciclo (0 = fecha de inicio) en que le toca la media jornada. Sin valor: lo escoge el sistema. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(13)
  shortDayOffset?: number;
}

export class MilkingRosterDto {
  @IsString()
  name!: string;

  @IsInt()
  @Min(1)
  @Max(10)
  stationsCount!: number;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => MilkingRosterWorkerDto)
  workers!: MilkingRosterWorkerDto[];

  /** Opcional: lunes de la "semana A", solo para devolver las fechas en la vista previa. */
  @IsOptional()
  @IsDateString()
  anchorDate?: string;

  @IsOptional()
  @Matches(HHMM)
  morningStart?: string;

  @IsOptional()
  @Matches(HHMM)
  morningEnd?: string;

  @IsOptional()
  @Matches(HHMM)
  eveningStart?: string;

  @IsOptional()
  @Matches(HHMM)
  eveningEnd?: string;

  /** true = solo calcula y devuelve como quedaria. false = guarda la rutina (no cambia el horario de nadie). */
  @IsOptional()
  @IsBoolean()
  preview?: boolean;
}

export class EnableMilkingRoutineDto {
  /** Lunes desde el que la rutina pasa a ser el horario de sus trabajadores. */
  @IsDateString()
  startDate!: string;
}
