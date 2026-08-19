import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface AuthenticatedUser {
  id: string;
  companyId: string;
  role: string;
  employeeCode: string;
}

/** Extrae el usuario autenticado (adjuntado por JwtStrategy.validate) de la request. */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
  const request = ctx.switchToHttp().getRequest();
  return request.user;
});
