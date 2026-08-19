import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
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

  static async hashPassword(plain: string): Promise<string> {
    return bcrypt.hash(plain, 10);
  }

  static async hashPin(pin: string): Promise<string> {
    return bcrypt.hash(pin, 10);
  }
}
