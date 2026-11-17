import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { MailerService } from './mailer.service';
import { WeeklyAlertService } from './weekly-alert.service';
import { AttendanceAlertService } from './attendance-alert.service';
import { EmailSettingsModule } from '../email-settings/email-settings.module';
import { NoveltiesModule } from '../novelties/novelties.module';

@Module({
  imports: [EmailSettingsModule, NoveltiesModule],
  controllers: [NotificationsController],
  providers: [MailerService, WeeklyAlertService, AttendanceAlertService],
  // MailerService exportado: lo reutiliza AuthModule para el correo de
  // restablecer contrasena, en vez de duplicar la logica de envio.
  // AttendanceAlertService: lo llaman kiosco y app al registrar una entrada.
  exports: [MailerService, AttendanceAlertService],
})
export class NotificationsModule {}
