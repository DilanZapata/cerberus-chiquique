import { Module } from '@nestjs/common';
import { ShiftPatternsController } from './shift-patterns.controller';
import { ShiftPatternsService } from './shift-patterns.service';

@Module({
  controllers: [ShiftPatternsController],
  providers: [ShiftPatternsService],
  exports: [ShiftPatternsService],
})
export class ShiftPatternsModule {}
