import { Module } from '@nestjs/common';
import { TimeLogsController } from './time-logs.controller';
import { TimeLogsService } from './time-logs.service';
import { JornadaCierreService } from './jornada-cierre.service';
import { NoveltiesModule } from '../novelties/novelties.module';

@Module({
  imports: [NoveltiesModule],
  controllers: [TimeLogsController],
  providers: [TimeLogsService, JornadaCierreService],
  exports: [JornadaCierreService],
})
export class TimeLogsModule {}
