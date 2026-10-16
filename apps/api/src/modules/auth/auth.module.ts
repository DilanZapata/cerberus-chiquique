import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET', 'change-me'),
        signOptions: { expiresIn: config.get<string>('JWT_EXPIRES_IN', '8h') },
      }),
    }),
    // Para enviar el correo del codigo de restablecer contrasena
    // reutilizando MailerService (misma config SMTP por empresa que las
    // alertas semanales).
    NotificationsModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [JwtModule],
})
export class AuthModule {}
