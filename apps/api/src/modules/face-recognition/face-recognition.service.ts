import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as path from 'path';
import * as tf from '@tensorflow/tfjs-node';
import * as faceapi from '@vladmandic/face-api';
import { Canvas, Image, ImageData, loadImage } from 'canvas';
import { PrismaService } from '../../database/prisma.service';
import { decodeBase64Image } from '../../common/utils/image.util';

// face-api corre sobre canvas/tfjs-node en este backend: la foto nunca sale
// hacia un servicio de reconocimiento facial de terceros (AWS/Azure/Google).
faceapi.env.monkeyPatch({ Canvas: Canvas as never, Image: Image as never, ImageData: ImageData as never });

const MODELS_PATH = path.join(process.cwd(), 'models');

/** Distancia por debajo de la cual dos rostros se consideran la misma persona (convencion de face-api). */
const MATCH_THRESHOLD = 0.5;

function euclideanDistance(a: Float32Array | number[], b: Float32Array | number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const diff = a[i] - b[i];
    sum += diff * diff;
  }
  return Math.sqrt(sum);
}

@Injectable()
export class FaceRecognitionService implements OnModuleInit {
  private readonly logger = new Logger(FaceRecognitionService.name);
  private modelsReady = false;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    try {
      await tf.setBackend('tensorflow');
      await tf.ready();
      await faceapi.nets.ssdMobilenetv1.loadFromDisk(MODELS_PATH);
      await faceapi.nets.faceLandmark68Net.loadFromDisk(MODELS_PATH);
      await faceapi.nets.faceRecognitionNet.loadFromDisk(MODELS_PATH);
      this.modelsReady = true;
      this.logger.log('Modelos de reconocimiento facial cargados.');
    } catch (error) {
      this.logger.error(`No se pudieron cargar los modelos de reconocimiento facial: ${(error as Error).message}`);
    }
  }

  private async extractDescriptor(imageBase64: string): Promise<Float32Array> {
    if (!this.modelsReady) {
      throw new BadRequestException('El servicio de reconocimiento facial no esta disponible en este momento.');
    }
    const buffer = decodeBase64Image(imageBase64);
    const image = await loadImage(buffer);
    const detection = await faceapi.detectSingleFace(image as never).withFaceLandmarks().withFaceDescriptor();
    if (!detection) {
      throw new BadRequestException('No se detecto ningun rostro en la imagen. Intenta con mejor luz y de frente a la camara.');
    }
    return detection.descriptor;
  }

  async enroll(userId: string, imageBase64: string, consentText: string) {
    const descriptor = await this.extractDescriptor(imageBase64);
    return this.prisma.faceEnrollment.upsert({
      where: { userId },
      create: { userId, descriptor: Array.from(descriptor), consentGivenAt: new Date(), consentText },
      update: { descriptor: Array.from(descriptor), consentGivenAt: new Date(), consentText },
    });
  }

  async revoke(userId: string) {
    await this.prisma.faceEnrollment.deleteMany({ where: { userId } });
    return { revoked: true };
  }

  async getStatus(userId: string) {
    const enrollment = await this.prisma.faceEnrollment.findUnique({ where: { userId } });
    return { enrolled: !!enrollment, consentGivenAt: enrollment?.consentGivenAt ?? null };
  }

  /** Identifica a que empleado de la empresa pertenece el rostro de la foto, si hay una coincidencia confiable. */
  async identify(companyId: string, imageBase64: string): Promise<{ userId: string; fullName: string; distance: number } | null> {
    const descriptor = await this.extractDescriptor(imageBase64);

    const enrollments = await this.prisma.faceEnrollment.findMany({
      where: { user: { companyId, isActive: true } },
      include: { user: { select: { id: true, fullName: true } } },
    });

    let best: { userId: string; fullName: string; distance: number } | null = null;
    for (const enrollment of enrollments) {
      const candidateDescriptor = enrollment.descriptor as number[];
      const distance = euclideanDistance(descriptor, candidateDescriptor);
      if (distance <= MATCH_THRESHOLD && (!best || distance < best.distance)) {
        best = { userId: enrollment.user.id, fullName: enrollment.user.fullName, distance };
      }
    }
    return best;
  }
}
