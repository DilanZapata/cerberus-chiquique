import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { UserRole } from '@prisma/client';

export enum ImportFieldMode {
  UNIFORM = 'UNIFORM',
  PER_ROW = 'PER_ROW',
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

  @IsOptional()
  @IsUUID()
  workSiteValue?: string;
}
