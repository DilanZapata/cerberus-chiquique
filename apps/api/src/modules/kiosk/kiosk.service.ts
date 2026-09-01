import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { TimeLogSource, User, WorkSite } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { haversineDistanceMeters } from '../../common/utils/geo.util';
import { resolveNextMark } from '../../common/utils/shift-marks.util';
import { saveTimeLogPhoto, deleteTimeLogPhoto } from '../../common/utils/photo-storage.util';
import { checkRecentSelfServiceMark, duplicateGuardMessage, withUserRegistrationLock } from '../../common/utils/duplicate-registration-guard.util';
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

  /**
   * Identifica el rostro de la foto SIN crear ninguna marca -- pensado para
   * el sondeo periodico ("polling") de la camara del kiosco mientras busca
   * a alguien frente a ella. Nunca lanza: mientras nadie este frente a la
   * camara (o el rostro todavia no se detecta bien), `identify()` lanza
   * `BadRequestException`, y para este endpoint ese es un resultado NORMAL
   * (recognized: false), no un error -- asi el cliente puede sondear cada
   * pocos segundos sin tener que distinguir "nadie ahi" de un error real.
   * Solo cuando el cliente detecte varias identificaciones consecutivas
   * estables de la MISMA persona debe llamar a `faceClock()` (el que si
   * registra la marca, con el guard de duplicados intacto).
   */
  async identifyFace(dto: KioskFaceClockDto): Promise<{ recognized: boolean; fullName?: string; distance?: number }> {
    const nearbySites = await this.findNearbyWorkSites(dto.latitude, dto.longitude);
    if (nearbySites.length === 0) return { recognized: false };

    const companyIds = [...new Set(nearbySites.map((s) => s.companyId))];
    for (const companyId of companyIds) {
      try {
        const match = await this.faceRecognitionService.identify(companyId, dto.imageBase64);
        if (match) return { recognized: true, fullName: match.fullName, distance: match.distance };
      } catch {
        // Sin rostro detectable en este frame, o modelos aun no listos: no
        // es un error para un sondeo periodico, simplemente sigue buscando.
      }
    }
    return { recognized: false };
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

    // Chequeo rapido (sin lock) ANTES de tocar la foto: cubre el caso comun
    // de un doble-toque accidental en el kiosco sin gastar el
    // guardado/redimension de la imagen. El chequeo autoritativo (con lock,
    // ver mas abajo) es el que realmente cierra la condicion de carrera
    // entre dos dispositivos marcando por la misma persona casi a la vez.
    const earlyCheck = await checkRecentSelfServiceMark(this.prisma, user.id, now);
    if (earlyCheck?.blocked) {
      throw new BadRequestException({
        message: duplicateGuardMessage(earlyCheck, user.fullName),
        secondsRemaining: earlyCheck.secondsRemaining,
      });
    }

    const photoUrl = imageBase64 ? await saveTimeLogPhoto(imageBase64, 'kiosk') : undefined;

    try {
      await withUserRegistrationLock(this.prisma, user.id, async (tx) => {
        const finalCheck = await checkRecentSelfServiceMark(tx, user.id, now);
        if (finalCheck?.blocked) {
          throw new BadRequestException({
            message: duplicateGuardMessage(finalCheck, user.fullName),
            secondsRemaining: finalCheck.secondsRemaining,
          });
        }

        await tx.timeLog.create({
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
      });
    } catch (err) {
      if (photoUrl) deleteTimeLogPhoto(photoUrl);
      throw err;
    }

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
