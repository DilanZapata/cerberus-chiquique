import { Body, Controller, Post } from '@nestjs/common';
import { KioskService } from './kiosk.service';
import { KioskClockDto } from './dto/kiosk-clock.dto';
import { KioskFaceClockDto } from './dto/kiosk-face-clock.dto';
import { Public } from '../../common/decorators/public.decorator';

/**
 * Sin autenticacion de dispositivo: el kiosco identifica su propia sede (y
 * por lo tanto la empresa) por proximidad GPS, igual que el marcaje de
 * autoservicio movil. Ver KioskService.findNearbyWorkSites.
 */
@Public()
@Controller('kiosk')
export class KioskController {
  constructor(private readonly kioskService: KioskService) {}

  @Post('clock')
  clock(@Body() dto: KioskClockDto) {
    return this.kioskService.clock(dto);
  }

  @Post('face-clock')
  faceClock(@Body() dto: KioskFaceClockDto) {
    return this.kioskService.faceClock(dto);
  }
}
