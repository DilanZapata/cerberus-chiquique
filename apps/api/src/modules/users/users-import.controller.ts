import { BadRequestException, Body, Controller, Get, Post, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { UserRole } from '@prisma/client';
import type { Response } from 'express';
import { UsersImportService } from './users-import.service';
import { BulkImportOptionsDto } from './dto/bulk-import-options.dto';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';

/**
 * Controller separado (en vez de agregar rutas a UsersController) porque
 * Nest/Express matchea rutas en el orden en que se registran: si esto
 * viviera dentro de @Controller('users'), "GET /users/import/template"
 * caeria en "GET /users/:id" (con id="import") a menos que se declarara
 * ANTES de esa ruta. Un controller aparte con su propio prefijo evita el
 * problema por completo.
 */
@Controller('users/import')
export class UsersImportController {
  constructor(private readonly usersImportService: UsersImportService) {}

  @Roles(UserRole.ADMIN, UserRole.HR)
  @Get('template')
  async downloadTemplate(@CurrentUser() user: AuthenticatedUser, @Res() res: Response) {
    const workbook = await this.usersImportService.generateTemplate(user.companyId);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="plantilla_empleados.xlsx"');
    await workbook.xlsx.write(res);
    res.end();
  }

  @Roles(UserRole.ADMIN, UserRole.HR)
  @Post()
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } }))
  async bulkImport(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: Express.Multer.File,
    @Body() options: BulkImportOptionsDto,
  ) {
    if (!file) throw new BadRequestException('Sube un archivo .xlsx');
    return this.usersImportService.bulkImport(user.companyId, file.buffer, options);
  }
}
