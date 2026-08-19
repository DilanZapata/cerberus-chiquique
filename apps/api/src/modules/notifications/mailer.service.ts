import { Injectable } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { EmailSettingsService } from '../email-settings/email-settings.service';

@Injectable()
export class MailerService {
  constructor(private readonly emailSettingsService: EmailSettingsService) {}

  async sendMail(companyId: string, opts: { subject: string; html: string; to?: string[] }): Promise<string[]> {
    const settings = await this.emailSettingsService.getDecryptedForSending(companyId);
    const transporter = nodemailer.createTransport({
      host: settings.smtpHost,
      port: settings.smtpPort,
      secure: settings.smtpSecurity === 'SSL',
      auth: { user: settings.smtpUser, pass: settings.smtpPassword },
    });

    const recipients = opts.to ?? settings.adminRecipients;
    await transporter.sendMail({
      from: `"${settings.fromName}" <${settings.fromEmail}>`,
      to: recipients.join(', '),
      subject: opts.subject,
      html: opts.html,
    });
    return recipients;
  }
}
