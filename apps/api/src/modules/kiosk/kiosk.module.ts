import { Module } from '@nestjs/common';
import { KioskController } from './kiosk.controller';
import { KioskService } from './kiosk.service';
import { NoveltiesModule } from '../novelties/novelties.module';
import { FaceRecognitionModule } from '../face-recognition/face-recognition.module';

@Module({
  imports: [NoveltiesModule, FaceRecognitionModule],
  controllers: [KioskController],
  providers: [KioskService],
})
export class KioskModule {}
