import { Module } from '@nestjs/common';
import { NoveltiesController } from './novelties.controller';
import { NoveltiesService } from './novelties.service';
import { OvertimeApprovalService } from './services/overtime-approval.service';
import { PayrollConfigModule } from '../payroll-config/payroll-config.module';
import { EmailSettingsModule } from '../email-settings/email-settings.module';
import { MailerService } from '../notifications/mailer.service';

@Module({
  // MailerService se provee aqui directamente (no importando
  // NotificationsModule, que a su vez importa este modulo): solo depende de
  // EmailSettingsService y no guarda estado, asi que una instancia propia
  // evita la dependencia circular. Lo usa NoveltiesService para avisar a
  // quien autorizo cuando se trabajan mas horas extra de las autorizadas.
  imports: [PayrollConfigModule, EmailSettingsModule],
  controllers: [NoveltiesController],
  providers: [NoveltiesService, OvertimeApprovalService, MailerService],
  exports: [NoveltiesService, OvertimeApprovalService],
})
export class NoveltiesModule {}
