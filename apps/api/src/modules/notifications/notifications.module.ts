import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { MailerService } from './mailer.service';
import { WeeklyAlertService } from './weekly-alert.service';
import { EmailSettingsModule } from '../email-settings/email-settings.module';

@Module({
  imports: [EmailSettingsModule],
  controllers: [NotificationsController],
  providers: [MailerService, WeeklyAlertService],
})
export class NotificationsModule {}
