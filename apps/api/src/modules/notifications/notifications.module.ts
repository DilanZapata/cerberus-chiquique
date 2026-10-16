import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { MailerService } from './mailer.service';
import { WeeklyAlertService } from './weekly-alert.service';
import { EmailSettingsModule } from '../email-settings/email-settings.module';

@Module({
  imports: [EmailSettingsModule],
  controllers: [NotificationsController],
  providers: [MailerService, WeeklyAlertService],
  // MailerService exportado: lo reutiliza AuthModule para el correo de
  // restablecer contrasena, en vez de duplicar la logica de envio.
  exports: [MailerService],
})
export class NotificationsModule {}
