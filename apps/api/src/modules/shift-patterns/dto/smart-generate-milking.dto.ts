import { ArrayMinSize, IsArray, IsDateString, IsInt, IsOptional, IsString, IsUUID, Matches, Max, Min } from 'class-validator';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export class SmartGenerateMilkingDto {
  @IsString()
  name!: string;

  /** Trabajadores sujetos al ciclo de descanso quincenal de ordeño. */
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  workerIds!: string[];

  /** Trabajador comodin opcional: siempre disponible, cubre ordeño o vaqueria segun haga falta. */
  @IsOptional()
  @IsUUID()
  comodinWorkerId?: string;

  /** Cantidad de ordeños (estaciones) simultaneos por dia. Cada uno necesita 2 ordeñadores + 1 vaquero. Default 1. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  stationsCount?: number;

  /** Trabajadores (de workerIds) que renuncian a su dia corto: trabajan jornada completa tambien ese dia. */
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  fullDayWorkerIds?: string[];

  /** Trabajadores (de workerIds) que renuncian al segundo descanso de la semana B: solo descansan 1 dia por semana. */
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  reducedRestWorkerIds?: string[];

  /** Vaqueros fijos, uno por ordeño (indice = estacion). Si no esta disponible ese dia, se asigna un reemplazo automaticamente. */
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  vaqueroWorkerIds?: string[];

  @IsDateString()
  anchorDate!: string;

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

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(26)
  horizonWeeks?: number;
}
