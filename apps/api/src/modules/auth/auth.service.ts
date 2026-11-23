import { BadRequestException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../database/prisma.service';
import { MailerService } from '../notifications/mailer.service';

// Vigencia del codigo de restablecer contrasena y limite de intentos antes
// de invalidarlo (evita que se pueda adivinar por fuerza bruta un codigo de
// 6 digitos mientras siga vigente).
const RESET_CODE_TTL_MINUTES = 15;
const RESET_CODE_MAX_ATTEMPTS = 5;

// Ingreso con cedula + PIN (app Cerberus Managers). Un PIN es corto, asi que
// tras varios intentos fallidos seguidos esa cedula queda bloqueada un rato:
// sin esto se podria adivinar probando los 10.000 PIN de 4 digitos.
const PIN_LOGIN_MAX_ATTEMPTS = 5;
const PIN_LOGIN_LOCK_MINUTES = 15;
// Solo estos roles entran con PIN: es la puerta de la app de jefes.
const PIN_LOGIN_ROLES = ['ADMIN', 'HR', 'SUPERVISOR'];

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly mailerService: MailerService,
  ) {}

  async login(email: string, password: string) {
    const user = await this.prisma.user.findFirst({ where: { email, isActive: true } });
    if (!user || !user.passwordHash) {
      throw new UnauthorizedException('Credenciales invalidas');
    }

    const passwordMatches = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedException('Credenciales invalidas');
    }

    const payload = {
      sub: user.id,
      companyId: user.companyId,
      role: user.role,
      employeeCode: user.employeeCode,
    };

    return {
      accessToken: await this.jwtService.signAsync(payload),
      user: {
        id: user.id,
        companyId: user.companyId,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        employeeCode: user.employeeCode,
      },
    };
  }

  /** Intentos fallidos de ingreso con PIN por cedula (en memoria: se limpia al reiniciar el servidor). */
  private readonly pinAttempts = new Map<string, { failures: number; lockedUntil: number }>();

  /**
   * Ingreso con cedula + PIN, para la app Cerberus Managers. Usa el mismo PIN
   * que la persona ya tiene para el kiosco. Solo roles de jefatura
   * (ADMIN / RRHH / SUPERVISOR). El mensaje de error es siempre el mismo,
   * exista o no esa cedula, para no revelar quien tiene cuenta.
   */
  async loginWithPin(nationalId: string, pin: string) {
    const key = nationalId.trim();
    const now = Date.now();
    const attempts = this.pinAttempts.get(key);
    if (attempts && attempts.lockedUntil > now) {
      const minutes = Math.ceil((attempts.lockedUntil - now) / 60_000);
      throw new UnauthorizedException(`Demasiados intentos. Espera ${minutes} min e intenta de nuevo.`);
    }

    const candidates = await this.prisma.user.findMany({
      where: { nationalId: key, isActive: true, pinHash: { not: null }, role: { in: PIN_LOGIN_ROLES as never[] } },
    });
    let user: (typeof candidates)[number] | undefined;
    for (const candidate of candidates) {
      if (await bcrypt.compare(pin, candidate.pinHash!)) {
        user = candidate;
        break;
      }
    }

    if (!user) {
      const failures = (attempts && attempts.lockedUntil <= now ? attempts.failures : 0) + 1;
      const locked = failures >= PIN_LOGIN_MAX_ATTEMPTS;
      this.pinAttempts.set(key, { failures: locked ? 0 : failures, lockedUntil: locked ? now + PIN_LOGIN_LOCK_MINUTES * 60_000 : 0 });
      throw new UnauthorizedException('Cedula o PIN incorrectos, o tu usuario no tiene acceso a esta app.');
    }
    this.pinAttempts.delete(key);

    const payload = { sub: user.id, companyId: user.companyId, role: user.role, employeeCode: user.employeeCode };
    return {
      accessToken: await this.jwtService.signAsync(payload),
      user: {
        id: user.id,
        companyId: user.companyId,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        employeeCode: user.employeeCode,
      },
    };
  }

  /**
   * Solicita el codigo de restablecer contrasena. SIEMPRE responde el mismo
   * mensaje generico exista o no esa cuenta -- para no revelar por esta via
   * que un correo si esta registrado (enumeracion de cuentas). Si la cuenta
   * existe, genera un codigo de 6 digitos, invalida los codigos anteriores
   * sin usar, lo guarda (solo su hash, nunca en claro) y lo envia por
   * correo usando la misma configuracion SMTP de la empresa que ya usan las
   * alertas (`MailerService`, ver notifications/weekly-alert.service.ts).
   */
  async forgotPassword(email: string): Promise<{ message: string }> {
    const genericResponse = {
      message: 'Si el correo esta registrado, te enviamos un codigo para restablecer tu contrasena.',
    };

    const user = await this.prisma.user.findFirst({ where: { email, isActive: true } });
    if (!user || !user.email) return genericResponse;

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const codeHash = await bcrypt.hash(code, 10);
    const expiresAt = new Date(Date.now() + RESET_CODE_TTL_MINUTES * 60_000);

    await this.prisma.$transaction([
      // Invalida cualquier codigo anterior sin usar: solo el ultimo
      // solicitado debe servir.
      this.prisma.passwordResetCode.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      }),
      this.prisma.passwordResetCode.create({
        data: { userId: user.id, codeHash, expiresAt },
      }),
    ]);

    const html = `
      <p>Hola ${user.fullName},</p>
      <p>Tu codigo para restablecer la contrasena de Cerberus es:</p>
      <p style="font-size:28px;font-weight:bold;letter-spacing:4px;">${code}</p>
      <p>Vence en ${RESET_CODE_TTL_MINUTES} minutos. Si no fuiste tu, ignora este correo.</p>
    `;

    try {
      await this.mailerService.sendMail(user.companyId, {
        subject: 'Codigo para restablecer tu contrasena',
        html,
        to: [user.email],
      });
    } catch (err) {
      // No se le revela al solicitante si el envio fallo (misma logica de
      // no-enumeracion de arriba); se deja constancia en el log del
      // servidor para que un admin pueda diagnosticarlo (ej. la empresa aun
      // no configuro su SMTP en Ajustes > Correo).
      this.logger.error(`No se pudo enviar el codigo de restablecer contrasena a ${user.email}: ${(err as Error).message}`);
    }

    return genericResponse;
  }

  /** Valida el codigo recibido por correo y, si es correcto y vigente, establece la nueva contrasena. */
  async resetPassword(email: string, code: string, newPassword: string): Promise<{ message: string }> {
    const user = await this.prisma.user.findFirst({ where: { email, isActive: true } });
    if (!user) throw new BadRequestException('Codigo invalido o vencido.');

    const resetCode = await this.prisma.passwordResetCode.findFirst({
      where: { userId: user.id, usedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!resetCode) throw new BadRequestException('Codigo invalido o vencido.');

    if (resetCode.attempts >= RESET_CODE_MAX_ATTEMPTS) {
      throw new BadRequestException('Superaste el numero de intentos permitidos. Solicita un nuevo codigo.');
    }

    const codeMatches = await bcrypt.compare(code, resetCode.codeHash);
    if (!codeMatches) {
      await this.prisma.passwordResetCode.update({
        where: { id: resetCode.id },
        data: { attempts: resetCode.attempts + 1 },
      });
      throw new BadRequestException('Codigo invalido o vencido.');
    }

    const passwordHash = await AuthService.hashPassword(newPassword);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: user.id }, data: { passwordHash } }),
      this.prisma.passwordResetCode.update({ where: { id: resetCode.id }, data: { usedAt: new Date() } }),
    ]);

    return { message: 'Contrasena actualizada correctamente.' };
  }

  static async hashPassword(plain: string): Promise<string> {
    return bcrypt.hash(plain, 10);
  }

  static async hashPin(pin: string): Promise<string> {
    return bcrypt.hash(pin, 10);
  }
}
