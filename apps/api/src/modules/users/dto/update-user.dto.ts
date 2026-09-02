import {
  IsArray,
  IsBoolean,
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
import { UserRole } from '@prisma/client';

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  fullName?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @IsOptional()
  @IsUUID()
  departmentId?: string;

  /** Si se envia (incluso vacio), reemplaza por completo las sedes asignadas. */
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  workSiteIds?: string[];

  @IsOptional()
  @IsUUID()
  positionId?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  baseSalary?: number;

  @IsOptional()
  @IsBoolean()
  allowsLunchSkip?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  @MinLength(4)
  password?: string;

  @IsOptional()
  @Matches(/^\d{4,6}$/, { message: 'El PIN debe tener entre 4 y 6 digitos' })
  pin?: string;
}
