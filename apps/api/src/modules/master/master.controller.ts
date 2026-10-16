import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { MasterService } from './master.service';
import { MasterResetDto } from './dto/master-reset.dto';
import { BootstrapCompanyDto } from './dto/bootstrap-company.dto';
import { ResetUserPasswordDto } from './dto/reset-user-password.dto';
import { MasterPasswordGuard } from './master-password.guard';
import { Public } from '../../common/decorators/public.decorator';

/**
 * Panel maestro: fuera del JWT normal (no depende de que exista ningun
 * usuario en la base de datos), protegido por MASTER_RESET_PASSWORD via
 * header `x-master-password`. Pensado para un unico operador de confianza,
 * no para uso cotidiano de ningun rol de la app.
 */
@Public()
@UseGuards(MasterPasswordGuard)
@Controller('master')
export class MasterController {
  constructor(private readonly masterService: MasterService) {}

  @Get('status')
  getStatus() {
    return this.masterService.getStatus();
  }

  @Post('reset')
  reset(@Body() dto: MasterResetDto) {
    return this.masterService.resetDatabase(dto);
  }

  @Post('bootstrap-company')
  bootstrapCompany(@Body() dto: BootstrapCompanyDto) {
    return this.masterService.bootstrapCompany(dto);
  }

  /** Busca un usuario de CUALQUIER empresa por nombre/correo/codigo/cedula. */
  @Get('users')
  searchUsers(@Query('q') q: string) {
    return this.masterService.searchUsers(q);
  }

  /** Establece una contrasena nueva para ese usuario, sin pasar por el codigo de correo. */
  @Post('users/:id/reset-password')
  resetUserPassword(@Param('id') id: string, @Body() dto: ResetUserPasswordDto) {
    return this.masterService.resetUserPassword(id, dto);
  }
}
