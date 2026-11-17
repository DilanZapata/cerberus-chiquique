import { ArrayUnique, IsArray, IsBoolean, IsIn, IsInt, IsOptional, Min } from 'class-validator';
import { UserRole } from '@prisma/client';

/** Roles a los que la empresa puede dar permiso de autorizar horas extra. */
export const OVERTIME_APPROVER_ROLE_OPTIONS: UserRole[] = [UserRole.ADMIN, UserRole.HR, UserRole.SUPERVISOR];

export class UpdatePayrollSettingsDto {
  @IsOptional()
  @IsBoolean()
  overtimeRequiresPreauthorization?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  overtimePendingAlertDays?: number;

  /**
   * Roles que pueden autorizar horas extra. ADMIN siempre queda incluido
   * (lo agrega el servicio) para que la empresa nunca se quede sin quien autorice.
   */
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(OVERTIME_APPROVER_ROLE_OPTIONS, { each: true })
  overtimeApproverRoles?: UserRole[];
}
