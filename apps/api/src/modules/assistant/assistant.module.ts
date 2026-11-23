import { Module } from '@nestjs/common';
import { NoveltiesModule } from '../novelties/novelties.module';
import { AssistantController } from './assistant.controller';
import { AssistantService } from './assistant.service';

@Module({
  imports: [NoveltiesModule],
  controllers: [AssistantController],
  providers: [AssistantService],
})
export class AssistantModule {}
