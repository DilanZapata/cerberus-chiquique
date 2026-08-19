import { Module } from '@nestjs/common';
import { MasterController } from './master.controller';
import { MasterService } from './master.service';
import { MasterPasswordGuard } from './master-password.guard';

@Module({
  controllers: [MasterController],
  providers: [MasterService, MasterPasswordGuard],
})
export class MasterModule {}
