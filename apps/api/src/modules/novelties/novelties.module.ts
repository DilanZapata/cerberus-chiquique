import { Module } from '@nestjs/common';
import { NoveltiesController } from './novelties.controller';
import { NoveltiesService } from './novelties.service';
import { OvertimeApprovalService } from './services/overtime-approval.service';
import { PayrollConfigModule } from '../payroll-config/payroll-config.module';

@Module({
  imports: [PayrollConfigModule],
  controllers: [NoveltiesController],
  providers: [NoveltiesService, OvertimeApprovalService],
  exports: [NoveltiesService, OvertimeApprovalService],
})
export class NoveltiesModule {}
