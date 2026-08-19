import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { MasterService } from './master.service';
import { MasterResetDto } from './dto/master-reset.dto';
import { BootstrapCompanyDto } from './dto/bootstrap-company.dto';
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
}
