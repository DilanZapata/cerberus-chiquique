import { TimeLogType } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { addDays, startOfLocalDay } from './time.util';

export const MARK_SEQUENCE: TimeLogType[] = [
  TimeLogType.CHECK_IN,
  TimeLogType.LUNCH_OUT,
  TimeLogType.LUNCH_IN,
  TimeLogType.CHECK_OUT,
];

export interface ShiftMarks {
  checkIn?: Date;
  lunchOut?: Date;
  lunchIn?: Date;
  checkOut?: Date;
}

function markValue(marks: ShiftMarks, type: TimeLogType): Date | undefined {
  if (type === TimeLogType.CHECK_IN) return marks.checkIn;
  if (type === TimeLogType.LUNCH_OUT) return marks.lunchOut;
  if (type === TimeLogType.LUNCH_IN) return marks.lunchIn;
  return marks.checkOut;
}

/**
 * Encuentra las marcas del turno que inicia en `date`, buscando la salida (y
 * las de almuerzo) en orden cronologico en vez de por dia calendario, para
 * soportar turnos que cruzan la medianoche (ej. vigilantes 10pm-6am). Se
 * acota a la proxima entrada (inicio de otro turno) si aparece antes, y a un
 * maximo de 24h desde la entrada como limite de seguridad.
 */
export async function findShiftMarks(prisma: PrismaService, userId: string, date: Date): Promise<ShiftMarks> {
  const dayEnd = addDays(date, 1);
  const checkInLog = await prisma.timeLog.findFirst({
    where: { userId, logType: TimeLogType.CHECK_IN, loggedAt: { gte: date, lt: dayEnd } },
    orderBy: { loggedAt: 'asc' },
  });
  if (!checkInLog) return {};

  const searchEnd = addDays(checkInLog.loggedAt, 1);
  const nextCheckIn = await prisma.timeLog.findFirst({
    where: { userId, logType: TimeLogType.CHECK_IN, loggedAt: { gt: checkInLog.loggedAt, lt: searchEnd } },
    orderBy: { loggedAt: 'asc' },
  });
  const boundary = nextCheckIn?.loggedAt ?? searchEnd;

  const subsequent = await prisma.timeLog.findMany({
    where: { userId, loggedAt: { gt: checkInLog.loggedAt, lt: boundary } },
    orderBy: { loggedAt: 'asc' },
  });

  const byType = (type: TimeLogType) => subsequent.find((l) => l.logType === type)?.loggedAt;

  return {
    checkIn: checkInLog.loggedAt,
    lunchOut: byType(TimeLogType.LUNCH_OUT),
    lunchIn: byType(TimeLogType.LUNCH_IN),
    checkOut: byType(TimeLogType.CHECK_OUT),
  };
}

/**
 * Determina la siguiente marca esperada (kiosco/app) para un empleado en el
 * instante `now`. Si ayer quedo un turno sin completar (ej. entro anoche y
 * aun no ha marcado salida) y no han pasado mas de 24h, continua ese turno en
 * vez de asumir que hoy es un dia nuevo — asi los vigilantes/turnos
 * nocturnos marcan su salida correctamente aunque ya sea "otro dia".
 */
export async function resolveNextMark(
  prisma: PrismaService,
  userId: string,
  now: Date,
): Promise<{ nextLogType: TimeLogType; workDate: string } | null> {
  const today = startOfLocalDay(now);
  const yesterday = addDays(today, -1);

  const yesterdayMarks = await findShiftMarks(prisma, userId, yesterday);
  if (yesterdayMarks.checkIn) {
    const hoursSinceCheckIn = (now.getTime() - yesterdayMarks.checkIn.getTime()) / 3_600_000;
    const nextType = MARK_SEQUENCE.find((type) => !markValue(yesterdayMarks, type));
    if (nextType && hoursSinceCheckIn <= 24) {
      return { nextLogType: nextType, workDate: yesterday.toISOString().slice(0, 10) };
    }
  }

  const todayMarks = await findShiftMarks(prisma, userId, today);
  const nextType = MARK_SEQUENCE.find((type) => !markValue(todayMarks, type));
  if (!nextType) return null;
  return { nextLogType: nextType, workDate: today.toISOString().slice(0, 10) };
}
