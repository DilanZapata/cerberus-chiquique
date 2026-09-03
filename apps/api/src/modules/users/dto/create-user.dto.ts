import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Min,
  MinLength,
} from 'class-validator';
import { CycleWeek, UserRole } from '@prisma/client';

export class CreateUserDto {
  @IsString()
  @MinLength(2)
  employeeCode!: string;

  @IsString()
  @MinLength(4)
  nationalId!: string;

  @IsString()
  @MinLength(2)
  fullName!: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @IsOptional()
  @IsUUID()
  departmentId?: string;

  /** Una persona puede tener varias sedes: el marcaje por GPS valida contra cualquiera de ellas. */
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  workSiteIds?: string[];

  /** El cargo trae su propio horario asociado (ver Position.scheduleId); scheduleId sigue disponible para asignar un horario individual que anula el del cargo. */
  @IsOptional()
  @IsUUID()
  positionId?: string;

  @IsOptional()
  @IsUUID()
  scheduleId?: string;

  /** Obligatoria (validado en el service) si el horario elegido es rotativo (Semana A/B). */
  @IsOptional()
  @IsDateString()
  cycleAnchorDate?: string;

  /** Obligatoria (validado en el service) si el horario elegido es rotativo (Semana A/B). */
  @IsOptional()
  @IsEnum(CycleWeek)
  cycleStartWeek?: CycleWeek;

  @IsDateString()
  hireDate!: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  baseSalary?: number;

  @IsOptional()
  @IsBoolean()
  allowsLunchSkip?: boolean;

  /** Contrasena para inicio de sesion en el panel web (opcional: solo roles con acceso al panel la necesitan). */
  @IsOptional()
  @IsString()
  @MinLength(4)
  password?: string;

  /** PIN de 4-6 digitos para marcar en el kiosco. */
  @IsOptional()
  @Matches(/^\d{4,6}$/, { message: 'El PIN debe tener entre 4 y 6 digitos' })
  pin?: string;
}
