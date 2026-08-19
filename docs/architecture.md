# Arquitectura

## Que es Cerberus

Sistema de gestion de personal, asistencia, turnos y liquidacion preliminar
de nomina, construido especificamente para cumplir el Codigo Sustantivo del
Trabajo (CST) colombiano: recargos nocturnos, dominicales/festivos, horas
extra con tope legal, descanso compensatorio habitual, jornadas rotativas,
etc.

## Monorepo

```
cerberus/
├── apps/
│   ├── api/       NestJS + Prisma + PostgreSQL — backend, unica fuente de verdad
│   ├── web/       Next.js (App Router) — panel administrativo/operativo
│   └── mobile/    Expo (React Native) — kiosco y app de empleado/admin
├── packages/
│   ├── cst-rules/     motor de calculo puro (sin dependencias de NestJS/DB)
│   └── shared-types/  enums e interfaces TypeScript compartidos entre las 3 apps
├── docker-compose.yml PostgreSQL para desarrollo
└── docs/              esta documentacion
```

Es un monorepo con npm workspaces (ver `package.json` raiz). No hay build
tool tipo Turborepo/Nx: cada app se corre/compila con sus propios scripts, y
los `packages/*` se importan directamente por nombre de paquete gracias a los
workspaces de npm.

### Por que `cst-rules` esta separado

El calculo de novedades (RNO, HEOD, HEFN, etc.) es la logica de negocio mas
critica y mas testeada del sistema. Vive en `packages/cst-rules` como
**funciones puras** (reciben datos, devuelven datos, sin tocar la base de
datos ni el filesystem) para poder:

1. Testearlo con `npx tsx` sin levantar NestJS ni Postgres.
2. Reusarlo identico en el calculo automatico (marcaje) y en el calculo
   manual (`modules/time-logs` cuando se cargan marcas a mano).

`apps/api` es la unica app que importa `cst-rules` hoy, pero al ser un
paquete independiente nada impide que `web`/`mobile` lo usen a futuro (por
ejemplo, para preview de calculo sin round-trip al servidor).

## Backend (`apps/api`)

NestJS clasico por modulos (`src/modules/<nombre>/{*.controller.ts,
*.service.ts, *.module.ts, dto/}`). Cada modulo de negocio sigue el mismo
patron: `service` con la logica + queries de Prisma, `controller` delgado
que solo valida DTOs y delega, `module` que los conecta.

Modulos principales:

| Modulo | Responsabilidad |
|---|---|
| `auth` | login (password para web/mobile-admin, PIN para kiosco), JWT, guards de rol |
| `companies` | empresa, departamentos, sedes |
| `users` | CRUD de empleados |
| `novelties` | orquesta el calculo diario llamando a `cst-rules` y persiste `Novelty` |
| `time-logs` | marcaje autoservicio desde mobile (GPS) + carga manual de marcas |
| `kiosk` | marcaje por PIN o rostro desde una terminal compartida |
| `face-recognition` | enrolamiento/identificacion facial (face-api.js + tfjs-node, local, sin servicios externos) |
| `overtime` | flujo de aprobacion de horas extra pendientes |
| `incidences` | flujo de aprobacion de permisos/incapacidades |
| `rest-credits` | descanso compensatorio (Art. 179/180 CST) |
| `shift-patterns` | plantillas de turnos rotativos + generador inteligente |
| `payroll-config` | tarifas legales versionadas por fecha de vigencia |
| `reports` | exportacion a Excel (`exceljs`) |
| `email-settings` / `notifications` | SMTP por empresa + alertas semanales por cron |

El kiosco (terminal compartida, sin login personal) no tiene ninguna
configuracion de dispositivo: identifica en que sede esta parado buscando,
entre todas las sedes con coordenadas, cuales caen dentro de su propio radio
de GPS (`KioskService.findNearbyWorkSites`, mismo mecanismo de geocerca que
usa el marcaje de autoservicio movil). De ahi deriva la(s) empresa(s)
candidatas y busca al empleado por codigo+PIN o por rostro. No hay un token
de dispositivo que configurar — la seguridad del modo kiosco es PIN/rostro
(algo que el empleado sabe/es) + proximidad fisica real a una sede
registrada (donde esta el empleado), no un secreto compartido por
instalacion.

`AppModule` (`src/app.module.ts`) importa todos los modulos. `PrismaService`
(`src/database/prisma.service.ts`) es el unico punto de acceso a la base de
datos, inyectado donde haga falta.

Fotos de marcaje (kiosco PIN, kiosco facial, mobile GPS) se guardan como
archivos en `apps/api/uploads/<subfolder>/<uuid>.jpg` y se sirven como
estaticos bajo `/uploads/*` (`useStaticAssets` en `main.ts`). En la base de
datos solo se guarda la ruta relativa (`TimeLog.photoUrl`), nunca una URL
absoluta, porque la IP/hostname del API cambia entre entornos — el frontend
antepone su `API_URL` actual al mostrarla.

## Web (`apps/web`)

Next.js App Router. Todas las paginas autenticadas viven bajo el grupo de
rutas `(app)` (`src/app/(app)/...`), envueltas por `AppShell`
(`src/components/AppShell.tsx`) que dibuja el sidebar y valida sesion en el
cliente (`getUser()` de `src/lib/auth.ts`, que lee de `localStorage`; si no
hay usuario, redirige a `/login`).

`src/lib/api.ts` es el unico lugar que hace `fetch` al backend — adjunta el
JWT (`Authorization: Bearer`) automaticamente. Cualquier pantalla nueva debe
agregar su funcion ahi en vez de hacer `fetch` directo.

## Mobile (`apps/mobile`)

Expo + React Navigation (`native-stack`). `AuthContext`
(`src/context/AuthContext.tsx`) carga la sesion guardada en
`AsyncStorage` (mismo shape que `StoredUser` en el web, ver
`src/services/auth.ts`) y expone `{session, loading, login, logout}`.

`RootNavigator` (`src/navigation/RootNavigator.tsx`) decide que stack de
pantallas mostrar segun el estado de sesion:

- **Sin sesion** → `SelectMode` (elegir Kiosco o Iniciar sesion), `Login`, `Kiosk`.
- **Con sesion, rol admin/RRHH/supervisor** (`isAdminRole`) → dashboard + gestion de empleados.
- **Con sesion, rol empleado** → pantalla unica de marcaje por GPS.

`src/services/api.ts` centraliza las llamadas HTTP (equivalente movil de
`lib/api.ts` en web), recibiendo el token como primer argumento porque
mobile no tiene un modulo global de storage sincrono como `localStorage`.

## Como se comunican las 3 apps

Todo pasa por el API REST de NestJS (`apps/api`, prefijo `/api`). Ni web ni
mobile hablan entre si ni comparten storage — cada una mantiene su propia
sesion JWT independiente contra el mismo backend. `packages/shared-types` es
la unica dependencia de codigo compartida entre las 3 (enums de roles,
codigos de novedad, etc.) para evitar que los strings se desincronicen.
