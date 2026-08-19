import { CanActivate, ExecutionContext, Injectable, InternalServerErrorException, UnauthorizedException } from '@nestjs/common';

/**
 * Protege los endpoints de /master con una contrasena maestra separada de
 * cualquier usuario de la base de datos (variable de entorno
 * MASTER_RESET_PASSWORD), para que siga funcionando incluso despues de
 * borrar toda la tabla de usuarios. Va en el header `x-master-password`,
 * no en el body, para no dejarla en logs de request bodies.
 */
@Injectable()
export class MasterPasswordGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expected = process.env.MASTER_RESET_PASSWORD;
    if (!expected) {
      throw new InternalServerErrorException('MASTER_RESET_PASSWORD no esta configurada en el servidor.');
    }

    const request = context.switchToHttp().getRequest();
    const provided = request.headers['x-master-password'];
    if (!provided || provided !== expected) {
      throw new UnauthorizedException('Contrasena maestra invalida.');
    }
    return true;
  }
}
