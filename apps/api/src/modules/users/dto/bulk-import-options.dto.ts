import { IsArray, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { Transform } from 'class-transformer';
import { UserRole } from '@prisma/client';

export enum ImportFieldMode {
  UNIFORM = 'UNIFORM',
  PER_ROW = 'PER_ROW',
}

/** Un campo de texto de multipart/form-data no puede llevar un array nativo: el frontend lo manda como JSON serializado en un solo campo. */
function parseJsonArray({ value }: { value: unknown }): unknown {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value) return undefined;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** Llega como campos de texto de un multipart/form-data junto con el archivo. */
export class BulkImportOptionsDto {
  @IsEnum(ImportFieldMode)
  roleMode!: ImportFieldMode;

  @IsOptional()
  @IsEnum(UserRole)
  roleValue?: UserRole;

  @IsEnum(ImportFieldMode)
  departmentMode!: ImportFieldMode;

  @IsOptional()
  @IsUUID()
  departmentValue?: string;

  @IsEnum(ImportFieldMode)
  workSiteMode!: ImportFieldMode;

  /** Una persona puede tener varias sedes: llega como un JSON serializado de un solo campo de texto (ver parseJsonArray). */
  @IsOptional()
  @Transform(parseJsonArray)
  @IsArray()
  @IsUUID('4', { each: true })
  workSiteValues?: string[];
}
