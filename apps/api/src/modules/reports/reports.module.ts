import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { AttendanceGridService } from './attendance-grid.service';
import { NoveltiesModule } from '../novelties/novelties.module';

@Module({
  imports: [NoveltiesModule],
  controllers: [ReportsController],
  providers: [ReportsService, AttendanceGridService],
})
export class ReportsModule {}
