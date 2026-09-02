import { Injectable } from '@nestjs/common';
import { TimeLogType } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Vista consolidada del dia: marcas y novedades de cada empleado. Pensada
   * para alimentar el dashboard de marcas/turnos del panel administrativo.
   */
  async getAttendanceForDate(workDate: string) {
    const date = new Date(`${workDate}T00:00:00`);
    const nextDay = addDays(date, 1);

    const [users, timeLogs, novelties] = await Promise.all([
      this.prisma.user.findMany({
        where: { isActive: true, role: 'EMPLOYEE' },
        include: { department: true, workSites: { include: { workSite: true } } },
        orderBy: { employeeCode: 'asc' },
      }),
      this.prisma.timeLog.findMany({
        where: { loggedAt: { gte: date, lt: nextDay } },
      }),
      this.prisma.novelty.findMany({
        where: { workDate: date },
        orderBy: { code: 'asc' },
      }),
    ]);

    const logsByUser = new Map<string, typeof timeLogs>();
    for (const log of timeLogs) {
      const list = logsByUser.get(log.userId) ?? [];
      list.push(log);
      logsByUser.set(log.userId, list);
    }

    const noveltiesByUser = new Map<string, typeof novelties>();
    for (const novelty of novelties) {
      const list = noveltiesByUser.get(novelty.userId) ?? [];
      list.push(novelty);
      noveltiesByUser.set(novelty.userId, list);
    }

    return users.map((user) => {
      const logs = logsByUser.get(user.id) ?? [];
      const find = (type: TimeLogType) => logs.find((l) => l.logType === type)?.loggedAt ?? null;

      return {
        user: {
          id: user.id,
          employeeCode: user.employeeCode,
          fullName: user.fullName,
          department: user.department?.name ?? null,
          workSite: user.workSites.map((a) => a.workSite.name).join(', ') || null,
        },
        marks: {
          checkIn: find(TimeLogType.CHECK_IN),
          lunchOut: find(TimeLogType.LUNCH_OUT),
          lunchIn: find(TimeLogType.LUNCH_IN),
          checkOut: find(TimeLogType.CHECK_OUT),
        },
        novelties: (noveltiesByUser.get(user.id) ?? []).map((n) => ({
          code: n.code,
          hours: n.hours.toNumber(),
          status: n.status,
          notes: n.notes,
        })),
      };
    });
  }
}
