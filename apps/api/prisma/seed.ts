import { PrismaClient, DayOfWeek, UserRole, ShiftRotation } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { NoveltiesService } from '../src/modules/novelties/novelties.service';
import { PayrollConfigService } from '../src/modules/payroll-config/payroll-config.service';
import { ShiftPatternsService } from '../src/modules/shift-patterns/shift-patterns.service';

const prisma = new PrismaClient();
const payrollConfigService = new PayrollConfigService(prisma as never);
const noveltiesService = new NoveltiesService(prisma as never, payrollConfigService);
const shiftPatternsService = new ShiftPatternsService(prisma as never);

function atTime(y: number, m: number, d: number, hh: number, mm = 0): Date {
  return new Date(y, m - 1, d, hh, mm, 0, 0);
}

function utcTime(hh: number, mm = 0): Date {
  return new Date(Date.UTC(1970, 0, 1, hh, mm));
}

async function main() {
  console.log('Sembrando datos de ejemplo...');

  const company = await prisma.company.create({
    data: {
      nit: '900123456-7',
      legalName: 'Cerberus Demo S.A.S.',
      tradeName: 'Cerberus Demo',
    },
  });

  await prisma.payrollSettings.create({ data: { companyId: company.id } });

  // Linea de tiempo legal (Ley 2466 de 2025 y progresion hasta 2027) - ver
  // apps/api/prisma/migrations/00000000000001_advanced/migration.sql para el
  // detalle; estos valores son de mejor esfuerzo y deben revisarse con el
  // equipo legal antes de usarse en produccion.
  await prisma.payrollConfigVersion.createMany({
    data: [
      {
        companyId: company.id,
        effectiveFrom: new Date('2025-07-01T00:00:00Z'),
        dayStartTime: utcTime(6, 0),
        nightStartTime: utcTime(21, 0),
        maxWeeklyHours: 42,
        pctDominicalFestivo: 0.8,
        pctDominicalFestivoNocturno: 1.15,
        pctHoraExtraFestivaDiurna: 1.05,
        pctHoraExtraFestivaNocturna: 1.55,
        notes: 'Ley 2466/2025: recargo dominical sube a 80%.',
      },
      {
        companyId: company.id,
        effectiveFrom: new Date('2025-12-25T00:00:00Z'),
        dayStartTime: utcTime(6, 0),
        nightStartTime: utcTime(19, 0),
        maxWeeklyHours: 42,
        pctDominicalFestivo: 0.8,
        pctDominicalFestivoNocturno: 1.15,
        pctHoraExtraFestivaDiurna: 1.05,
        pctHoraExtraFestivaNocturna: 1.55,
        notes: 'Ley 2466/2025: jornada nocturna pasa a iniciar a las 19:00.',
      },
      {
        companyId: company.id,
        effectiveFrom: new Date('2026-07-01T00:00:00Z'),
        dayStartTime: utcTime(6, 0),
        nightStartTime: utcTime(19, 0),
        maxWeeklyHours: 42,
        pctDominicalFestivo: 0.9,
        pctDominicalFestivoNocturno: 1.25,
        pctHoraExtraFestivaDiurna: 1.15,
        pctHoraExtraFestivaNocturna: 1.65,
        notes: 'Ley 2466/2025: recargo dominical sube a 90% (vigente hoy).',
      },
      {
        companyId: company.id,
        effectiveFrom: new Date('2027-07-01T00:00:00Z'),
        dayStartTime: utcTime(6, 0),
        nightStartTime: utcTime(19, 0),
        maxWeeklyHours: 42,
        pctDominicalFestivo: 1.0,
        pctDominicalFestivoNocturno: 1.35,
        pctHoraExtraFestivaDiurna: 1.25,
        pctHoraExtraFestivaNocturna: 1.75,
        notes: 'Ley 2466/2025: recargo dominical llega al 100%.',
      },
    ],
  });

  const department = await prisma.department.create({
    data: { companyId: company.id, name: 'Operaciones' },
  });

  const workSite = await prisma.workSite.create({
    data: {
      companyId: company.id,
      name: 'Sede Principal Bogota',
      address: 'Calle 100 # 15-20, Bogota',
      latitude: 4.710989,
      longitude: -74.07209,
    },
  });

  const schedule = await prisma.schedule.create({
    data: {
      companyId: company.id,
      name: 'Horario Administrativo (Lunes a Viernes 8-5)',
      weeklyHoursTarget: 42,
      defaultLunchMinutes: 60,
      lunchToleranceMinutes: 10,
    },
  });

  const workingDays: DayOfWeek[] = [
    DayOfWeek.MONDAY,
    DayOfWeek.TUESDAY,
    DayOfWeek.WEDNESDAY,
    DayOfWeek.THURSDAY,
    DayOfWeek.FRIDAY,
  ];
  for (const dayOfWeek of Object.values(DayOfWeek)) {
    const isWorkingDay = workingDays.includes(dayOfWeek);
    await prisma.scheduleDetail.create({
      data: {
        scheduleId: schedule.id,
        dayOfWeek,
        isWorkingDay,
        startTime: isWorkingDay ? utcTime(8, 0) : null,
        endTime: isWorkingDay ? utcTime(17, 0) : null,
      },
    });
  }

  const demoPin = await bcrypt.hash('1234', 10);
  const employeesData = [
    { code: 'EMP001', nationalId: '1000000001', fullName: 'Ana Empleada', allowsLunchSkip: false },
    { code: 'EMP002', nationalId: '1000000002', fullName: 'Carlos Turno', allowsLunchSkip: false },
    { code: 'EMP003', nationalId: '1000000003', fullName: 'Beatriz Almuerzo', allowsLunchSkip: false },
    { code: 'EMP004', nationalId: '1000000004', fullName: 'Diego Abandona', allowsLunchSkip: false },
    { code: 'EMP005', nationalId: '1000000005', fullName: 'Elena Dominical', allowsLunchSkip: true },
  ];

  const employees: Record<string, { id: string }> = {};
  for (const emp of employeesData) {
    const user = await prisma.user.create({
      data: {
        companyId: company.id,
        departmentId: department.id,
        workSiteId: workSite.id,
        employeeCode: emp.code,
        nationalId: emp.nationalId,
        fullName: emp.fullName,
        email: `${emp.code.toLowerCase()}@cerberusdemo.co`,
        role: UserRole.EMPLOYEE,
        hireDate: new Date(2024, 0, 15),
        baseSalary: 2500000,
        allowsLunchSkip: emp.allowsLunchSkip,
        pinHash: demoPin,
      },
    });
    employees[emp.code] = user;

    await prisma.userSchedule.create({
      data: { userId: user.id, scheduleId: schedule.id, validFrom: new Date(2024, 0, 15) },
    });
  }

  const supervisorPassword = await bcrypt.hash('supervisor123', 10);
  const supervisor = await prisma.user.create({
    data: {
      companyId: company.id,
      departmentId: department.id,
      employeeCode: 'SUP001',
      nationalId: '1000000000',
      fullName: 'Sofia Supervisora',
      email: 'sup001@cerberusdemo.co',
      role: UserRole.SUPERVISOR,
      hireDate: new Date(2023, 0, 1),
      baseSalary: 4500000,
      passwordHash: supervisorPassword,
    },
  });

  const adminPassword = await bcrypt.hash('admin123', 10);
  const admin = await prisma.user.create({
    data: {
      companyId: company.id,
      employeeCode: 'ADM001',
      nationalId: '1000000099',
      fullName: 'Admin Cerberus',
      email: 'admin@cerberusdemo.co',
      role: UserRole.ADMIN,
      hireDate: new Date(2023, 0, 1),
      baseSalary: 6000000,
      passwordHash: adminPassword,
    },
  });

  // ---- Marcas de ejemplo ----
  // Lunes 20 jul 2026 = festivo (Independencia de Colombia). Martes 21 = dia ordinario. Domingos: 5, 12, 19 jul.

  // Ana: dia festivo normal (8-12/1-5) y dia ordinario normal, sin novedades.
  await prisma.timeLog.createMany({
    data: [
      { userId: employees.EMP001.id, workSiteId: workSite.id, logType: 'CHECK_IN', loggedAt: atTime(2026, 7, 20, 8) },
      { userId: employees.EMP001.id, workSiteId: workSite.id, logType: 'LUNCH_OUT', loggedAt: atTime(2026, 7, 20, 12) },
      { userId: employees.EMP001.id, workSiteId: workSite.id, logType: 'LUNCH_IN', loggedAt: atTime(2026, 7, 20, 13) },
      { userId: employees.EMP001.id, workSiteId: workSite.id, logType: 'CHECK_OUT', loggedAt: atTime(2026, 7, 20, 17) },
      { userId: employees.EMP001.id, workSiteId: workSite.id, logType: 'CHECK_IN', loggedAt: atTime(2026, 7, 21, 8) },
      { userId: employees.EMP001.id, workSiteId: workSite.id, logType: 'LUNCH_OUT', loggedAt: atTime(2026, 7, 21, 12) },
      { userId: employees.EMP001.id, workSiteId: workSite.id, logType: 'LUNCH_IN', loggedAt: atTime(2026, 7, 21, 13) },
      { userId: employees.EMP001.id, workSiteId: workSite.id, logType: 'CHECK_OUT', loggedAt: atTime(2026, 7, 21, 17) },
    ],
  });

  // Carlos: martes con jornada extendida hasta las 9:30pm -> HEOD + RNO/HEON.
  await prisma.timeLog.createMany({
    data: [
      { userId: employees.EMP002.id, workSiteId: workSite.id, logType: 'CHECK_IN', loggedAt: atTime(2026, 7, 21, 8) },
      { userId: employees.EMP002.id, workSiteId: workSite.id, logType: 'LUNCH_OUT', loggedAt: atTime(2026, 7, 21, 12) },
      { userId: employees.EMP002.id, workSiteId: workSite.id, logType: 'LUNCH_IN', loggedAt: atTime(2026, 7, 21, 13) },
      { userId: employees.EMP002.id, workSiteId: workSite.id, logType: 'CHECK_OUT', loggedAt: atTime(2026, 7, 21, 21, 30) },
    ],
  });

  // Beatriz: reingreso de almuerzo 40 min tarde.
  await prisma.timeLog.createMany({
    data: [
      { userId: employees.EMP003.id, workSiteId: workSite.id, logType: 'CHECK_IN', loggedAt: atTime(2026, 7, 21, 8) },
      { userId: employees.EMP003.id, workSiteId: workSite.id, logType: 'LUNCH_OUT', loggedAt: atTime(2026, 7, 21, 12) },
      { userId: employees.EMP003.id, workSiteId: workSite.id, logType: 'LUNCH_IN', loggedAt: atTime(2026, 7, 21, 13, 40) },
      { userId: employees.EMP003.id, workSiteId: workSite.id, logType: 'CHECK_OUT', loggedAt: atTime(2026, 7, 21, 17, 40) },
    ],
  });

  // Diego: sale a almuerzo y nunca marca reingreso (checkout registrado 4h despues, sin Marca 3).
  await prisma.timeLog.createMany({
    data: [
      { userId: employees.EMP004.id, workSiteId: workSite.id, logType: 'CHECK_IN', loggedAt: atTime(2026, 7, 21, 8) },
      { userId: employees.EMP004.id, workSiteId: workSite.id, logType: 'LUNCH_OUT', loggedAt: atTime(2026, 7, 21, 12) },
      { userId: employees.EMP004.id, workSiteId: workSite.id, logType: 'CHECK_OUT', loggedAt: atTime(2026, 7, 21, 16) },
    ],
  });

  // Elena: trabaja 3 domingos en julio (5, 12, 19), jornada corrida -> DDCOF cada vez;
  // el 3ro debe disparar el credito de descanso compensatorio (habitual, Art. 180 CST).
  await prisma.timeLog.createMany({
    data: [
      { userId: employees.EMP005.id, workSiteId: workSite.id, logType: 'CHECK_IN', loggedAt: atTime(2026, 7, 5, 8) },
      { userId: employees.EMP005.id, workSiteId: workSite.id, logType: 'CHECK_OUT', loggedAt: atTime(2026, 7, 5, 16) },
      { userId: employees.EMP005.id, workSiteId: workSite.id, logType: 'CHECK_IN', loggedAt: atTime(2026, 7, 12, 8) },
      { userId: employees.EMP005.id, workSiteId: workSite.id, logType: 'CHECK_OUT', loggedAt: atTime(2026, 7, 12, 16) },
      { userId: employees.EMP005.id, workSiteId: workSite.id, logType: 'CHECK_IN', loggedAt: atTime(2026, 7, 19, 8) },
      { userId: employees.EMP005.id, workSiteId: workSite.id, logType: 'CHECK_OUT', loggedAt: atTime(2026, 7, 19, 16) },
    ],
  });

  console.log('Marcas creadas. Ejecutando el motor de calculo de novedades...');

  const jobs: Array<[string, string]> = [
    [employees.EMP001.id, '2026-07-20'],
    [employees.EMP001.id, '2026-07-21'],
    [employees.EMP002.id, '2026-07-21'],
    [employees.EMP003.id, '2026-07-21'],
    [employees.EMP004.id, '2026-07-21'],
    [employees.EMP005.id, '2026-07-05'],
    [employees.EMP005.id, '2026-07-12'],
    [employees.EMP005.id, '2026-07-19'],
  ];

  for (const [userId, workDate] of jobs) {
    const result = await noveltiesService.calculateAndPersistForDay(userId, workDate);
    console.log(`  -> ${workDate} usuario ${userId.slice(0, 8)}: ${result.novelties.map((n) => `${n.code}=${n.hours}h`).join(', ') || 'sin novedades'}`);
  }

  // ---- Permiso/incapacidad de ejemplo: Diego tiene una incapacidad general el 22 de julio ----
  const incidence = await prisma.incidence.create({
    data: {
      userId: employees.EMP004.id,
      code: 'INCAPACIDAD_GENERAL',
      startDate: new Date('2026-07-22T00:00:00'),
      endDate: new Date('2026-07-22T00:00:00'),
      hoursPerDay: 8,
      notes: 'Incapacidad general de ejemplo, pendiente de aprobacion.',
    },
  });
  console.log(`Incidencia de ejemplo creada (pendiente): ${incidence.id}`);

  // ---- Rutina de turno rotativo de ejemplo: 4x3 (4 dias diurno, 3 de descanso) ----
  const pattern = await prisma.shiftPattern.create({
    data: {
      companyId: company.id,
      name: 'Rotativo 4x3',
      cycleLengthDays: 7,
      days: {
        create: [
          { dayOffset: 0, isRestDay: false, rotationType: ShiftRotation.DIURNO, startTime: utcTime(7, 0), endTime: utcTime(15, 0) },
          { dayOffset: 1, isRestDay: false, rotationType: ShiftRotation.DIURNO, startTime: utcTime(7, 0), endTime: utcTime(15, 0) },
          { dayOffset: 2, isRestDay: false, rotationType: ShiftRotation.DIURNO, startTime: utcTime(7, 0), endTime: utcTime(15, 0) },
          { dayOffset: 3, isRestDay: false, rotationType: ShiftRotation.DIURNO, startTime: utcTime(7, 0), endTime: utcTime(15, 0) },
          { dayOffset: 4, isRestDay: true, rotationType: ShiftRotation.DESCANSO },
          { dayOffset: 5, isRestDay: true, rotationType: ShiftRotation.DESCANSO },
          { dayOffset: 6, isRestDay: true, rotationType: ShiftRotation.DESCANSO },
        ],
      },
    },
  });
  await shiftPatternsService.assignToUser(pattern.id, {
    userId: employees.EMP002.id,
    anchorDate: '2026-07-20',
    validFrom: '2026-07-20',
  });
  const generated = await shiftPatternsService.generateShiftsForUser(
    employees.EMP002.id,
    new Date('2026-07-20T00:00:00'),
    new Date('2026-08-16T00:00:00'),
  );
  console.log(`Rutina "${pattern.name}" asignada a Carlos Turno, ${generated} turnos generados.`);

  console.log('\nListo. Empresa:', company.legalName, '(id:', company.id, ')');
  console.log('Supervisor:', supervisor.fullName, '| login: sup001@cerberusdemo.co / supervisor123');
  console.log('Admin:', admin.fullName, '| login: admin@cerberusdemo.co / admin123');
  console.log('PIN de kiosco para todos los empleados demo: 1234 (el kiosco identifica la sede por GPS, sin token: usa lat/lon', workSite.latitude, workSite.longitude, ')');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
