import { PrismaClient, NoveltyStatus as PrismaNoveltyStatus } from '@prisma/client';
import { NoveltyStatus } from '@cerberus/shared-types';
import { NoveltiesService } from '../src/modules/novelties/novelties.service';
import { PayrollConfigService } from '../src/modules/payroll-config/payroll-config.service';
import { OvertimeApprovalService } from '../src/modules/novelties/services/overtime-approval.service';
import { IncidencesService } from '../src/modules/incidences/incidences.service';

const prisma = new PrismaClient();
const payrollConfigService = new PayrollConfigService(prisma as never);
const noveltiesService = new NoveltiesService(prisma as never, payrollConfigService);
const overtimeApprovalService = new OvertimeApprovalService(prisma as never);
const incidencesService = new IncidencesService(prisma as never, noveltiesService);

function atTime(y: number, m: number, d: number, hh: number, mm = 0): Date {
  return new Date(y, m - 1, d, hh, mm, 0, 0);
}

async function userIdByCode(code: string): Promise<string> {
  const user = await prisma.user.findFirstOrThrow({ where: { employeeCode: code } });
  return user.id;
}

async function main() {
  console.log('Agregando escenarios adicionales de ejemplo...');

  const workSite = await prisma.workSite.findFirstOrThrow({});
  const supervisor = await prisma.user.findFirstOrThrow({ where: { employeeCode: 'SUP001' } });

  const ana = await userIdByCode('EMP001');
  const carlos = await userIdByCode('EMP002');
  const beatriz = await userIdByCode('EMP003');
  const diego = await userIdByCode('EMP004');

  // ---- 1. Beatriz: llegada tarde a la entrada (lunes 13 jul, 25 min tarde) ----
  await prisma.timeLog.createMany({
    data: [
      { userId: beatriz, workSiteId: workSite.id, logType: 'CHECK_IN', loggedAt: atTime(2026, 7, 13, 8, 25) },
      { userId: beatriz, workSiteId: workSite.id, logType: 'LUNCH_OUT', loggedAt: atTime(2026, 7, 13, 12, 25) },
      { userId: beatriz, workSiteId: workSite.id, logType: 'LUNCH_IN', loggedAt: atTime(2026, 7, 13, 13, 25) },
      { userId: beatriz, workSiteId: workSite.id, logType: 'CHECK_OUT', loggedAt: atTime(2026, 7, 13, 17, 25) },
    ],
  });

  // ---- 2. Ana: salida anticipada (martes 14 jul, sale 1.5h antes) ----
  await prisma.timeLog.createMany({
    data: [
      { userId: ana, workSiteId: workSite.id, logType: 'CHECK_IN', loggedAt: atTime(2026, 7, 14, 8) },
      { userId: ana, workSiteId: workSite.id, logType: 'LUNCH_OUT', loggedAt: atTime(2026, 7, 14, 12) },
      { userId: ana, workSiteId: workSite.id, logType: 'LUNCH_IN', loggedAt: atTime(2026, 7, 14, 13) },
      { userId: ana, workSiteId: workSite.id, logType: 'CHECK_OUT', loggedAt: atTime(2026, 7, 14, 15, 30) },
    ],
  });

  // ---- 3. Carlos: 3 dias de horas extra (antes de que empiece su rutina rotativa el 20 jul) ----
  // Miercoles 15: sale a las 19:30 (2.5h extra) -> se va a APROBAR.
  await prisma.timeLog.createMany({
    data: [
      { userId: carlos, workSiteId: workSite.id, logType: 'CHECK_IN', loggedAt: atTime(2026, 7, 15, 8) },
      { userId: carlos, workSiteId: workSite.id, logType: 'LUNCH_OUT', loggedAt: atTime(2026, 7, 15, 12) },
      { userId: carlos, workSiteId: workSite.id, logType: 'LUNCH_IN', loggedAt: atTime(2026, 7, 15, 13) },
      { userId: carlos, workSiteId: workSite.id, logType: 'CHECK_OUT', loggedAt: atTime(2026, 7, 15, 19, 30) },
    ],
  });
  // Jueves 16: sale a las 20:00 (3h extra) -> se va a RECHAZAR.
  await prisma.timeLog.createMany({
    data: [
      { userId: carlos, workSiteId: workSite.id, logType: 'CHECK_IN', loggedAt: atTime(2026, 7, 16, 8) },
      { userId: carlos, workSiteId: workSite.id, logType: 'LUNCH_OUT', loggedAt: atTime(2026, 7, 16, 12) },
      { userId: carlos, workSiteId: workSite.id, logType: 'LUNCH_IN', loggedAt: atTime(2026, 7, 16, 13) },
      { userId: carlos, workSiteId: workSite.id, logType: 'CHECK_OUT', loggedAt: atTime(2026, 7, 16, 20) },
    ],
  });
  // Viernes 17: sale a las 19:00 (2h extra) -> se deja PENDIENTE (sin decision).
  await prisma.timeLog.createMany({
    data: [
      { userId: carlos, workSiteId: workSite.id, logType: 'CHECK_IN', loggedAt: atTime(2026, 7, 17, 8) },
      { userId: carlos, workSiteId: workSite.id, logType: 'LUNCH_OUT', loggedAt: atTime(2026, 7, 17, 12) },
      { userId: carlos, workSiteId: workSite.id, logType: 'LUNCH_IN', loggedAt: atTime(2026, 7, 17, 13) },
      { userId: carlos, workSiteId: workSite.id, logType: 'CHECK_OUT', loggedAt: atTime(2026, 7, 17, 19) },
    ],
  });

  // ---- 4. Diego: un solo domingo trabajado en julio (ocasional, sin credito compensatorio) ----
  await prisma.timeLog.createMany({
    data: [
      { userId: diego, workSiteId: workSite.id, logType: 'CHECK_IN', loggedAt: atTime(2026, 7, 5, 8) },
      { userId: diego, workSiteId: workSite.id, logType: 'CHECK_OUT', loggedAt: atTime(2026, 7, 5, 16) },
    ],
  });

  console.log('Marcas creadas. Calculando novedades...');

  const jobs: Array<[string, string]> = [
    [beatriz, '2026-07-13'],
    [ana, '2026-07-14'],
    [carlos, '2026-07-15'],
    [carlos, '2026-07-16'],
    [carlos, '2026-07-17'],
    [diego, '2026-07-05'],
  ];
  for (const [userId, workDate] of jobs) {
    const result = await noveltiesService.calculateAndPersistForDay(userId, workDate);
    console.log(`  -> ${workDate} usuario ${userId.slice(0, 8)}: ${result.novelties.map((n) => `${n.code}=${n.hours}h`).join(', ') || 'sin novedades'}`);
  }

  // ---- 5. Decisiones sobre las horas extra de Carlos: aprobar la del 15, rechazar la del 16, dejar pendiente la del 17 ----
  async function findPendingApprovalFor(userId: string, workDate: string) {
    const novelty = await prisma.novelty.findFirst({
      where: { userId, workDate: new Date(`${workDate}T00:00:00`), code: 'HORA_EXTRA_PENDIENTE' },
    });
    if (!novelty) return null;
    return prisma.overtimeApproval.findFirst({ where: { noveltyId: novelty.id } });
  }

  const approvalJul15 = await findPendingApprovalFor(carlos, '2026-07-15');
  if (approvalJul15) {
    await overtimeApprovalService.review(
      approvalJul15.id,
      { status: NoveltyStatus.APROBADA, approvedHours: approvalJul15.requestedHours.toNumber(), notes: 'Autorizada por cierre de mes.' },
      supervisor.id,
    );
    console.log('  -> Horas extra de Carlos (15 jul) APROBADAS.');
  }

  const approvalJul16 = await findPendingApprovalFor(carlos, '2026-07-16');
  if (approvalJul16) {
    await overtimeApprovalService.review(
      approvalJul16.id,
      { status: NoveltyStatus.RECHAZADA, notes: 'No se justifica, no se aprueba el pago de horas extra.' },
      supervisor.id,
    );
    console.log('  -> Horas extra de Carlos (16 jul) RECHAZADAS.');
  }
  // La del 17 jul se deja sin decidir a proposito, para verse en el panel "Horas Extra" como pendiente.

  // ---- 6. Permiso remunerado APROBADO para Ana (viernes 17 jul, sin marcas ese dia) ----
  const permisoAna = await incidencesService.create({
    userId: ana,
    code: 'PERMISO_REMUNERADO' as never,
    startDate: '2026-07-17',
    endDate: '2026-07-17',
    hoursPerDay: 8,
    notes: 'Cita medica de rutina.',
  } as never);
  await incidencesService.review(permisoAna.id, { status: NoveltyStatus.APROBADA, notes: 'Aprobado por RRHH.' }, supervisor.id);
  console.log('  -> Permiso remunerado de Ana (17 jul) creado y APROBADO.');

  // ---- 7. Permiso no remunerado RECHAZADO para Beatriz (16 jul) ----
  const permisoBeatriz = await incidencesService.create({
    userId: beatriz,
    code: 'PERMISO_NO_REMUNERADO' as never,
    startDate: '2026-07-16',
    endDate: '2026-07-16',
    hoursPerDay: 8,
    notes: 'Diligencia personal.',
  } as never);
  await incidencesService.review(permisoBeatriz.id, { status: NoveltyStatus.RECHAZADA, notes: 'No se aprueba, periodo de cierre.' }, supervisor.id);
  console.log('  -> Permiso no remunerado de Beatriz (16 jul) creado y RECHAZADO.');

  console.log('\nListo. Escenarios adicionales sembrados:');
  console.log(' - Beatriz: llegada tarde (13 jul)');
  console.log(' - Ana: salida anticipada (14 jul) + permiso remunerado aprobado (17 jul)');
  console.log(' - Carlos: horas extra aprobadas (15 jul), rechazadas (16 jul), pendientes de decision (17 jul)');
  console.log(' - Diego: domingo ocasional trabajado sin credito compensatorio (5 jul) + incapacidad pendiente ya existente (22 jul)');
  console.log(' - Beatriz: permiso no remunerado rechazado (16 jul)');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
