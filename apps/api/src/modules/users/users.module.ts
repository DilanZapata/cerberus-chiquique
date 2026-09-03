import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { UsersImportController } from './users-import.controller';
import { UsersImportService } from './users-import.service';
import { NoveltiesModule } from '../novelties/novelties.module';

@Module({
  // UsersImportController va ANTES que UsersController: Nest/Express
  // registra rutas en este orden, y "users/import/*" debe matchear antes
  // que el "users/:id" de UsersController.
  imports: [NoveltiesModule],
  controllers: [UsersImportController, UsersController],
  providers: [UsersService, UsersImportService],
})
export class UsersModule {}
