import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { TimeLogSource, User, WorkSite } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { haversineDistanceMeters } from '../../common/utils/geo.util';
import { resolveNextMark } from '../../common/utils/shift-marks.util';
import { saveTimeLogPhoto } from '../../common/utils/photo-storage.util';
import { NoveltiesService } from '../novelties/novelties.service';
import { FaceRecognitionService } from '../face-recognition/face-recognition.service';
import { KioskClockDto } from './dto/kiosk-clock.dto';
import { KioskFaceClockDto } from './dto/kiosk-face-clock.dto';

@Injectable()
export class KioskService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly noveltiesService: NoveltiesService,
    private readonly faceRecognitionService: FaceRecognitionService,
  ) {}

  /**
   * El kiosco no tiene token ni sede configurados: identifica en que sede(s)
   * esta parado buscando, entre TODAS las sedes con coordenadas, cuales
   * caen dentro de su propio radio de GPS permitido. De ahi se derivan las
   * empresas candidatas para buscar al empleado (por codigo+PIN o por
   * rostro). Es el mismo mecanismo de geocerca que ya usa el marcaje GPS de
   * autoservicio movil, solo que aqui se busca la sede a partir del punto
   * en vez de validar contra la sede ya asignada de un usuario conocido.
   */
  private async findNearbyWorkSites(latitude: number, longitude: number): Promise<WorkSite[]> {
    const candidates = await this.prisma.workSite.findMany({
      where: { latitude: { not: null }, longitude: { not: null } },
    });
    return candidates.filter((site) => {
      const distance = haversineDistanceMeters(latitude, longitude, site.latitude!.toNumber(), site.longitude!.toNumber());
      return distance <= site.gpsRadiusMeters;
    });
  }

  /** Marca la siguiente entrada/salida esperada del empleado, identificado por codigo + PIN. */
  async clock(dto: KioskClockDto) {
    const nearbySites = await this.findNearbyWorkSites(dto.latitude, dto.longitude);
    if (nearbySites.length === 0) {
      throw new BadRequestException(
        `No hay ninguna sede registrada cerca de esta ubicacion (lat: ${dto.latitude.toFixed(6)}, lon: ${dto.longitude.toFixed(6)}). Pide a un administrador que cree o ajuste una sede con estas coordenadas en Empleados -> Sedes.`,
      );
    }
    const companyIds = [...new Set(nearbySites.map((s) => s.companyId))];

    const user = await this.prisma.user.findFirst({
      where: { employeeCode: dto.employeeCode, companyId: { in: companyIds }, isActive: true },
    });
    if (!user || !user.pinHash) {
      throw new UnauthorizedException('Empleado o PIN invalido');
    }

    const pinMatches = await bcrypt.compare(dto.pin, user.pinHash);
    if (!pinMatches) {
      throw new UnauthorizedException('Empleado o PIN invalido');
    }

    const workSite = nearbySites.find((s) => s.companyId === user.companyId)!;
    return this.registerMark(user, workSite.id, dto.latitude, dto.longitude, dto.imageBase64);
  }

  /** Marca la siguiente entrada/salida esperada del empleado, identificado por reconocimiento facial. */
  async faceClock(dto: KioskFaceClockDto) {
    const nearbySites = await this.findNearbyWorkSites(dto.latitude, dto.longitude);
    if (nearbySites.length === 0) {
      throw new BadRequestException(
        `No hay ninguna sede registrada cerca de esta ubicacion (lat: ${dto.latitude.toFixed(6)}, lon: ${dto.longitude.toFixed(6)}). Pide a un administrador que cree o ajuste una sede con estas coordenadas en Empleados -> Sedes.`,
      );
    }
    const companyIds = [...new Set(nearbySites.map((s) => s.companyId))];

    let match: { userId: string } | null = null;
    for (const companyId of companyIds) {
      match = await this.faceRecognitionService.identify(companyId, dto.imageBase64);
      if (match) break;
    }
    if (!match) {
      throw new UnauthorizedException('No se reconocio ningun rostro enrolado. Intenta de nuevo o usa tu PIN.');
    }

    const user = await this.prisma.user.findFirstOrThrow({ where: { id: match.userId, isActive: true } });
    const workSite = nearbySites.find((s) => s.companyId === user.companyId)!;
    // La misma foto que se uso para identificar la persona queda como evidencia del marcaje.
    return this.registerMark(user, workSite.id, dto.latitude, dto.longitude, dto.imageBase64);
  }

  private async registerMark(
    user: User,
    workSiteId: string,
    latitude: number,
    longitude: number,
    imageBase64?: string,
  ) {
    const now = new Date();
    // La interpretacion de la marca (entrada/almuerzo/salida) se basa en el
    // horario REAL asignado al empleado (resolveMarkContext, misma
    // resolucion que usa el calculo de novedades), no en adivinar por
    // secuencia -- asi una salida tardia sin marcas de almuerzo se reconoce
    // como salida final, y una marca de un dia nuevo nunca completa el turno
    // de ayer salvo que ese turno realmente cruce la medianoche.
    const context = await this.noveltiesService.resolveMarkContext(user.id, now);
    const resolved = await resolveNextMark(this.prisma, user.id, now, context);
    if (!resolved) {
      throw new BadRequestException(`${user.fullName} ya completo las 4 marcas de hoy.`);
    }

    const photoUrl = imageBase64 ? await saveTimeLogPhoto(imageBase64, 'kiosk') : undefined;

    await this.prisma.timeLog.create({
      data: {
        userId: user.id,
        workSiteId,
        logType: resolved.nextLogType,
        loggedAt: now,
        source: TimeLogSource.KIOSK,
        latitude,
        longitude,
        gpsValid: true, // ya se valido que cae dentro del radio de la sede al identificarla (findNearbyWorkSites)
        photoUrl,
      },
    });

    await this.noveltiesService.calculateAndPersistForDay(user.id, resolved.workDate);

    return {
      fullName: user.fullName,
      employeeCode: user.employeeCode,
      logType: resolved.nextLogType,
      loggedAt: now,
      reason: resolved.reason,
    };
  }
}
