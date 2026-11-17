import { Module } from '@nestjs/common';
import { KioskController } from './kiosk.controller';
import { KioskService } from './kiosk.service';
import { NoveltiesModule } from '../novelties/novelties.module';
import { FaceRecognitionModule } from '../face-recognition/face-recognition.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NoveltiesModule, FaceRecognitionModule, NotificationsModule],
  controllers: [KioskController],
  providers: [KioskService],
})
export class KioskModule {}
