import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from './database/prisma.module';
import { NoveltiesModule } from './modules/novelties/novelties.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { AuthModule } from './modules/auth/auth.module';
import { PayrollConfigModule } from './modules/payroll-config/payroll-config.module';
import { ShiftPatternsModule } from './modules/shift-patterns/shift-patterns.module';
import { IncidencesModule } from './modules/incidences/incidences.module';
import { RestCreditsModule } from './modules/rest-credits/rest-credits.module';
import { KioskModule } from './modules/kiosk/kiosk.module';
import { EmailSettingsModule } from './modules/email-settings/email-settings.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { ReportsModule } from './modules/reports/reports.module';
import { TimeLogsModule } from './modules/time-logs/time-logs.module';
import { CompaniesModule } from './modules/companies/companies.module';
import { UsersModule } from './modules/users/users.module';
import { FaceRecognitionModule } from './modules/face-recognition/face-recognition.module';
import { MasterModule } from './modules/master/master.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    PrismaModule,
    AuthModule,
    NoveltiesModule,
    DashboardModule,
    PayrollConfigModule,
    ShiftPatternsModule,
    IncidencesModule,
    RestCreditsModule,
    KioskModule,
    EmailSettingsModule,
    NotificationsModule,
    ReportsModule,
    TimeLogsModule,
    CompaniesModule,
    UsersModule,
    FaceRecognitionModule,
    MasterModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
