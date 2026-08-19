import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import { json } from 'express';
import { join } from 'path';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // Las fotos de enrolamiento/marcaje facial viajan como base64 en el body;
  // el limite por defecto de Express (100kb) no alcanza para una foto de camara.
  app.use(json({ limit: '10mb' }));
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableCors();
  // Fotos de evidencia de marcaje (kiosco, movil, facial), fuera del prefijo
  // /api para que sean URLs de archivo estatico directas.
  app.useStaticAssets(join(process.cwd(), 'uploads'), { prefix: '/uploads' });
  app.setGlobalPrefix('api');

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
}

bootstrap();
