import { Prisma, PrismaClient, TimeLogSource } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

/**
 * Minutos minimos que deben pasar entre dos marcas de auto-registro
 * (kiosco o app movil) de la MISMA persona antes de permitir otra, sin
 * importar que tipo de marca resulte (CHECK_IN, LUNCH_OUT, etc.). El
 * objetivo es bloquear toques repetidos por accidente sobre el mismo
 * flujo de registro (la persona vuelve a tocar "marcar" o su foto no
 * cargo y reintenta de inmediato), no distinguir tipos de marca -- esos
 * ya los decide `resolveNextMark` segun el horario real de la persona.
 */
export const DUPLICATE_REGISTRATION_WINDOW_MIN = 5;

// Fuentes sujetas al guard: solo los flujos de auto-registro con foto
// (kiosco de PIN/reconocimiento facial, app movil por GPS). Las
// correcciones manuales (MANUAL) y el cierre automatico de jornadas
// (AUTO_CLOSE) quedan fuera a proposito -- no son intentos repetidos de
// una persona tocando un boton, son acciones administrativas o del
// sistema que no deben verse limitadas por esta regla.
const SELF_SERVICE_SOURCES: TimeLogSource[] = [TimeLogSource.KIOSK, TimeLogSource.MOBILE_GPS];

type QueryClient = Pick<PrismaClient, 'timeLog'> | Prisma.TransactionClient;

export interface DuplicateGuardCheck {
  blocked: boolean;
  /** Segundos que faltan para poder registrar de nuevo (0 si ya no esta bloqueado). */
  secondsRemaining: number;
  /** Segundos transcurridos desde la ultima marca de auto-registro. */
  elapsedSeconds: number;
  lastLoggedAt: Date;
}

/**
 * Revisa si la ultima marca de auto-registro (kiosco/movil) de este
 * usuario ocurrio hace menos de `DUPLICATE_REGISTRATION_WINDOW_MIN`
 * minutos. Funcion centralizada: la usan tanto `KioskService.registerMark`
 * como `TimeLogsService.mobileClock`, para no duplicar la logica del
 * intervalo en cada flujo. No escribe nada -- es responsabilidad del
 * llamador decidir que hacer con el resultado (rechazar, o proceder).
 *
 * `client` puede ser el PrismaService normal (chequeo rapido, sin lock,
 * para rechazar temprano en el caso comun sin gastar trabajo de mas) o el
 * `tx` de una transaccion con `withUserRegistrationLock` (chequeo
 * autoritativo, el que realmente cierra la condicion de carrera).
 */
export async function checkRecentSelfServiceMark(client: QueryClient, userId: string, now: Date): Promise<DuplicateGuardCheck | null> {
  const last = await client.timeLog.findFirst({
    where: { userId, source: { in: SELF_SERVICE_SOURCES } },
    orderBy: { loggedAt: 'desc' },
    select: { loggedAt: true },
  });
  if (!last) return null;

  const windowMs = DUPLICATE_REGISTRATION_WINDOW_MIN * 60_000;
  const elapsedMs = now.getTime() - last.loggedAt.getTime();
  const secondsRemaining = Math.max(0, Math.ceil((windowMs - elapsedMs) / 1000));

  return {
    blocked: elapsedMs < windowMs,
    secondsRemaining,
    elapsedSeconds: Math.max(0, Math.floor(elapsedMs / 1000)),
    lastLoggedAt: last.loggedAt,
  };
}

/** "hace 45 segundos" / "hace 2 minutos" -- para el registro anterior, ya pasado. */
function formatElapsed(seconds: number): string {
  if (seconds < 60) return `hace ${seconds} segundo${seconds === 1 ? '' : 's'}`;
  const minutes = Math.round(seconds / 60);
  return `hace ${minutes} minuto${minutes === 1 ? '' : 's'}`;
}

/** "en 5 minutos" -- para cuanto falta, siempre redondeado hacia arriba a minutos completos para no prometer menos tiempo del que realmente falta. */
function formatRemaining(seconds: number): string {
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return `en ${minutes} minuto${minutes === 1 ? '' : 's'}`;
}

/**
 * Mensaje exacto que ve la persona cuando el guard bloquea su intento.
 * `fullName` es opcional: en el kiosco compartido (sin sesion propia) es
 * necesario identificar a quien se le bloqueo el intento, ya que la
 * pantalla la puede estar viendo otra persona distinta.
 */
export function duplicateGuardMessage(check: DuplicateGuardCheck, fullName?: string): string {
  const subject = fullName ? `${fullName} ya realizo` : 'Ya realizaste';
  return `${subject} un registro ${formatElapsed(check.elapsedSeconds)}. Podra${fullName ? '' : 's'} registrar de nuevo ${formatRemaining(check.secondsRemaining)}.`;
}

/**
 * Ejecuta `fn` dentro de una transaccion con un advisory lock de Postgres
 * exclusivo para este usuario (`pg_advisory_xact_lock`): si dos
 * solicitudes del mismo usuario llegan casi al mismo tiempo (ej. dos
 * dispositivos marcando a la vez), la segunda espera a que la primera
 * termine (commit o rollback) antes de poder leer/escribir -- cerrando la
 * condicion de carrera del guard de duplicados sin bloquear a otros
 * usuarios entre si (el lock es por hash del userId, no global). El lock
 * se libera solo, automaticamente, al terminar la transaccion.
 */
export async function withUserRegistrationLock<T>(
  prisma: PrismaService,
  userId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
    return fn(tx);
  });
}
