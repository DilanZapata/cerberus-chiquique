import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import { encryptSecret, decryptSecret } from '../../common/utils/crypto.util';
import { UpsertEmailSettingsDto } from './dto/upsert-email-settings.dto';

@Injectable()
export class EmailSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private get encryptionSecret(): string {
    return this.config.get<string>('EMAIL_ENCRYPTION_SECRET', 'change-me-in-production');
  }

  async get(companyId: string) {
    const settings = await this.prisma.emailSettings.findUnique({ where: { companyId } });
    if (!settings) return null;
    // Nunca se expone la contrasena descifrada por la API.
    const { smtpPasswordEncrypted: _omit, ...safe } = settings;
    return safe;
  }

  async upsert(companyId: string, dto: UpsertEmailSettingsDto) {
    const smtpPasswordEncrypted = encryptSecret(dto.smtpPassword, this.encryptionSecret);
    const data = {
      smtpHost: dto.smtpHost,
      smtpPort: dto.smtpPort,
      smtpUser: dto.smtpUser,
      smtpPasswordEncrypted,
      smtpSecurity: dto.smtpSecurity,
      fromName: dto.fromName,
      fromEmail: dto.fromEmail,
      adminRecipients: dto.adminRecipients,
      weeklyAlertEnabled: dto.weeklyAlertEnabled ?? true,
    };
    const settings = await this.prisma.emailSettings.upsert({
      where: { companyId },
      create: { companyId, ...data },
      update: data,
    });
    const { smtpPasswordEncrypted: _omit, ...safe } = settings;
    return safe;
  }

  /** Uso interno (NotificationsModule): entrega la config con la contrasena SMTP en claro para autenticar. */
  async getDecryptedForSending(companyId: string) {
    const settings = await this.prisma.emailSettings.findUnique({ where: { companyId } });
    if (!settings) {
      throw new NotFoundException(`No hay configuracion SMTP para la empresa ${companyId}`);
    }
    return {
      ...settings,
      smtpPassword: decryptSecret(settings.smtpPasswordEncrypted, this.encryptionSecret),
    };
  }
}
