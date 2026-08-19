import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class BootstrapCompanyDto {
  @IsString()
  @MinLength(3)
  legalName!: string;

  @IsString()
  @MinLength(3)
  nit!: string;

  @IsOptional()
  @IsString()
  tradeName?: string;

  @IsString()
  @MinLength(2)
  adminFullName!: string;

  @IsString()
  @MinLength(3)
  adminNationalId!: string;

  @IsEmail()
  adminEmail!: string;

  @IsString()
  @MinLength(4)
  adminPassword!: string;
}
