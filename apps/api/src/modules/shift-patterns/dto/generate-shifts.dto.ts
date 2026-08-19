import { IsDateString, IsOptional, IsUUID } from 'class-validator';

export class GenerateShiftsDto {
  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsDateString()
  from!: string;

  @IsDateString()
  to!: string;
}
