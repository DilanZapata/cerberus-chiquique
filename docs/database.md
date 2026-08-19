# Modelo de datos

PostgreSQL vía Prisma. Esquema completo en
[`apps/api/prisma/schema.prisma`](../apps/api/prisma/schema.prisma) — este
documento es un mapa para orientarte, no un sustituto de leerlo cuando vayas
a tocar un modelo.

Todo el esquema es **multi-tenant por `companyId`**: casi cada tabla raíz
cuelga de `Company` (directa o indirectamente vía `User`), y los queries del
backend siempre filtran por la empresa del usuario autenticado — nunca
confíes en un ID que venga del cliente sin verificar que pertenece a la
misma `companyId` del JWT.

## Organización

- **`Company`** — la empresa (tenant). `nit` único.
- **`Department`** — departamentos de la empresa.
- **`WorkSite`** — sedes físicas: coordenadas + `gpsRadiusMeters` (radio permitido para marcaje GPS y para que el kiosco identifique en qué sede está parado — ver `architecture.md`).

## Usuarios

- **`User`** — empleados. `role` (`ADMIN`/`HR`/`SUPERVISOR`/`EMPLOYEE`) controla permisos. `passwordHash` (login web/mobile) y `pinHash` (kiosco) son independientes y opcionales — un empleado puede tener uno, otro, o ambos. `supervisorId` es auto-referencia para jerarquía. `allowsLunchSkip` permite jornada continua sin almuerzo.
- **`FaceEnrollment`** — 1:1 con `User`. Guarda el descriptor facial (128 floats de face-api.js, como JSON) + `consentGivenAt`/`consentText` (dato biométrico sensible, Ley 1581 de 2012 — el consentimiento explícito es obligatorio antes de crear el registro).

## Horarios y turnos

Dos sistemas paralelos, para dos casos de uso distintos:

- **`Schedule` + `ScheduleDetail` + `UserSchedule`** — horario fijo semanal ("Lunes a Viernes 8-5, Sábado medio día"). `ScheduleDetail` tiene una fila por día de la semana. `UserSchedule` asigna un horario a un usuario con vigencia (`validFrom`/`validTo`), permitiendo cambios de horario en el tiempo sin perder el histórico.
- **`ShiftPattern` + `ShiftPatternDay` + `UserShiftPatternAssignment`** — plantillas cíclicas para turnos rotativos (ej. 2 personas cubriendo 24h con ciclo de 4 días). `ShiftPatternDay.dayOffset` es la posición dentro del ciclo; `UserShiftPatternAssignment.anchorDate` es la fecha desde la que se cuenta el ciclo para ese usuario (`dayIndex = diasEntre(anchorDate, fecha) mod cycleLengthDays`).
- **`Shift`** — turno concreto ya materializado para un usuario en una fecha (`plannedStart`/`plannedEnd`/`isRestDay`). Tanto el horario fijo como el generador de patrones terminan escribiendo aquí; es la tabla que consulta el motor de cálculo para saber "qué se esperaba que trabajara este usuario este día".

## Marcaje

- **`TimeLog`** — cada marca individual (entrada, salida a almuerzo, reingreso, salida). `logType` se infiere automáticamente por secuencia (nunca lo elige el usuario). `source` distingue de dónde vino (`KIOSK`/`MOBILE_GPS`/`WEB`/`MANUAL`). `latitude`/`longitude`/`gpsValid` solo aplican a marcaje móvil. `photoUrl` es la ruta relativa a la foto de evidencia (ver `architecture.md`), presente en los tres métodos de marcaje.

## Cálculo de nómina (CST)

- **`PayrollConfigVersion`** — tarifas legales (recargos, jornada diurna/nocturna, topes de horas extra) con vigencia por fecha (`effectiveFrom`). La ley colombiana ha cambiado estos valores progresivamente (Ley 2466 de 2025 y sucesoras hasta 2027), así que nunca hay "un solo valor editable": se resuelve la versión vigente en la fecha del cálculo con `ORDER BY effective_from DESC LIMIT 1 WHERE effective_from <= fecha`.
- **`PayrollSettings`** — ajustes operativos que no dependen de la ley (si las horas extra requieren preautorización, cada cuántos días alertar de pendientes).
- **`Novelty`** — el resultado del cálculo: una fila por combinación usuario+fecha+código (`RNO`, `HEOD`, `LLEGADA_TARDE`, etc.). `status` distingue `AUTO_CALCULADA` (el sistema la generó sola, ej. recargo nocturno) de `PENDIENTE`/`APROBADA`/`RECHAZADA` (requiere revisión humana, ej. horas extra). `origin` distingue si vino del marcaje automático, carga manual, o importación.
- **`OvertimeApproval`** — flujo de aprobación de horas extra, 1:1 con una `Novelty` de código `HEOD`/`HEON`/`HEFD`/`HEFN` que nació pendiente.
- **`Incidence`** — permisos e incapacidades (rango de fechas + código de novedad). Al aprobarse, el motor de cálculo la detecta y persiste directamente esa novedad para esas fechas en vez de calcular a partir de marcas.
- **`CompensatoryRestCredit`** — descanso compensatorio (Art. 179/180 CST): se crea automáticamente cuando un usuario supera el máximo de dominicales/festivos "ocasionales" trabajados en un mes calendario.
- **`AttendanceDailyTotal`** — totales agregados por usuario+día, usados por el reporte de nómina.

## Notificaciones

- **`EmailSettings`** — config SMTP por empresa. La contraseña se guarda cifrada (`smtpPasswordEncrypted`, AES-256-GCM con secreto en `.env`), no hasheada, porque el backend necesita el valor real para autenticar contra el servidor SMTP.
- **`NotificationLog`** — histórico de envíos (alertas semanales de novedades pendientes).

## Otros

- **`Holiday`** — festivos colombianos (incluye Ley Emiliani, festivos que se trasladan al lunes siguiente).
- **`AuditLog`** — bitácora genérica de acciones (`entity`/`entityId`/`action`/`diff`), poco usada hoy pero preparada para auditoría.

## Convención de nombres

Prisma usa `camelCase` en el cliente TS y `@map`/`@@map` para mapear a
`snake_case` en las columnas/tablas reales de Postgres — es intencional,
mantenlo al agregar campos nuevos (no mezclar camelCase directo en SQL).
