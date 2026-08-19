import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { FaceRecognitionService } from './face-recognition.service';
import { EnrollFaceDto } from './dto/enroll-face.dto';
import { Roles } from '../../common/decorators/roles.decorator';

@Roles(UserRole.ADMIN, UserRole.HR)
@Controller('face')
export class FaceRecognitionController {
  constructor(private readonly faceRecognitionService: FaceRecognitionService) {}

  @Post('enroll')
  enroll(@Body() dto: EnrollFaceDto) {
    return this.faceRecognitionService.enroll(dto.userId, dto.imageBase64, dto.consentText);
  }

  @Delete('enroll/:userId')
  revoke(@Param('userId') userId: string) {
    return this.faceRecognitionService.revoke(userId);
  }

  @Get('status/:userId')
  status(@Param('userId') userId: string) {
    return this.faceRecognitionService.getStatus(userId);
  }
}
