import { Module } from '@nestjs/common';
import { TimeLogsController } from './time-logs.controller';
import { TimeLogsService } from './time-logs.service';
import { NoveltiesModule } from '../novelties/novelties.module';

@Module({
  imports: [NoveltiesModule],
  controllers: [TimeLogsController],
  providers: [TimeLogsService],
})
export class TimeLogsModule {}
