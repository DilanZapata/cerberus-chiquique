import { Module } from '@nestjs/common';
import { IncidencesController } from './incidences.controller';
import { IncidencesService } from './incidences.service';
import { NoveltiesModule } from '../novelties/novelties.module';

@Module({
  imports: [NoveltiesModule],
  controllers: [IncidencesController],
  providers: [IncidencesService],
})
export class IncidencesModule {}
