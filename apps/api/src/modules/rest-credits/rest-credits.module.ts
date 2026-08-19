import { Module } from '@nestjs/common';
import { RestCreditsController } from './rest-credits.controller';
import { RestCreditsService } from './rest-credits.service';

@Module({
  controllers: [RestCreditsController],
  providers: [RestCreditsService],
})
export class RestCreditsModule {}
