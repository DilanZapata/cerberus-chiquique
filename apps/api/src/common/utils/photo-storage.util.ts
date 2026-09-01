import { randomUUID } from 'crypto';
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import { createCanvas, loadImage } from 'canvas';
import { decodeBase64Image } from './image.util';

const UPLOADS_ROOT = join(process.cwd(), 'uploads');

// Es solo evidencia del marcaje, no una foto de perfil: no hace falta mas
// resolucion que esta para verificarla a simple vista, y mantiene el peso
// del archivo bajo control sin importar la resolucion de la camara del
// dispositivo que la tomo.
const MAX_DIMENSION_PX = 640;
const JPEG_QUALITY = 0.6;

/** Redimensiona (si hace falta) y recomprime una foto a JPEG para no acumular archivos pesados. */
async function resizeToJpeg(buffer: Buffer): Promise<Buffer> {
  const image = await loadImage(buffer);
  const scale = Math.min(1, MAX_DIMENSION_PX / Math.max(image.width, image.height));
  const width = Math.round(image.width * scale);
  const height = Math.round(image.height * scale);

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0, width, height);

  return canvas.toBuffer('image/jpeg', { quality: JPEG_QUALITY });
}

/**
 * Guarda una foto (base64) en disco bajo `uploads/<subfolder>/` (dentro del
 * proyecto, `apps/api/uploads`) y devuelve la ruta relativa publica (servida
 * via NestExpressApplication.useStaticAssets, ver main.ts) para guardar en
 * la base de datos. Se guarda la ruta relativa, no la URL absoluta, porque
 * la IP/host del servidor puede cambiar (red local). La foto se redimensiona
 * y recomprime antes de escribirla: es solo evidencia, no hace falta guardar
 * la resolucion original de la camara.
 */
export async function saveTimeLogPhoto(imageBase64: string, subfolder: string): Promise<string> {
  const dir = join(UPLOADS_ROOT, subfolder);
  mkdirSync(dir, { recursive: true });

  const original = decodeBase64Image(imageBase64);
  const resized = await resizeToJpeg(original);
  const filename = `${randomUUID()}.jpg`;
  writeFileSync(join(dir, filename), resized);

  return `/uploads/${subfolder}/${filename}`;
}

/**
 * Borra una foto guardada por `saveTimeLogPhoto`, dada su ruta relativa
 * ("/uploads/<subfolder>/<archivo>"). Uso: limpiar la foto de un marcaje
 * que se guardo en disco pero cuyo TimeLog termino rechazado (ej. por el
 * guard de registros duplicados) para no acumular archivos huerfanos.
 * Best-effort: nunca lanza -- un fallo al borrar no debe tumbar la
 * respuesta de error que ya se esta devolviendo por la razon original.
 */
export function deleteTimeLogPhoto(photoUrl: string): void {
  try {
    const relative = photoUrl.replace(/^\/uploads\//, '');
    const fullPath = join(UPLOADS_ROOT, relative);
    if (existsSync(fullPath)) unlinkSync(fullPath);
  } catch {
    // Ignorado a proposito, ver comentario arriba.
  }
}
