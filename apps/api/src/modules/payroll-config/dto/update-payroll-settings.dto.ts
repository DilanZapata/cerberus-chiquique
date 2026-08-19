import { IsBoolean, IsInt, IsOptional, Min } from 'class-validator';

export class UpdatePayrollSettingsDto {
  @IsOptional()
  @IsBoolean()
  overtimeRequiresPreauthorization?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  overtimePendingAlertDays?: number;
}
