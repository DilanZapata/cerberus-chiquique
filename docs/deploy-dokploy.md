# Despliegue en Dokploy

Esta guia deja `apps/api` y `apps/web` corriendo en un servidor con Dokploy,
con Postgres administrado por el propio Dokploy, y `apps/mobile` apuntando a
esa API en produccion.

Reemplaza `tudominio.com` por tu dominio real en todos los pasos. Se asume:

- Web publica en `https://app.tudominio.com`
- API publica en `https://api.tudominio.com`

## 0. Que se preparo en el repo

- `apps/api/Dockerfile` y `apps/web/Dockerfile`: build multi-stage, contexto
  = raiz del monorepo (necesario porque usa npm workspaces).
- `apps/api/docker-entrypoint.sh`: corre `prisma migrate deploy` (con
  reintentos) antes de arrancar la API.
- `docker-compose.yml` (raiz): el que Dokploy va a desplegar. Servicios `api`
  y `web`, sin Postgres (ese lo administra Dokploy aparte).
- `docker-compose.local-test.yml`: para probar el mismo build localmente
  antes de subir nada (ver paso 1).
- `apps/web/next.config.js`: el proxy interno `/api/*` -> API ya no esta
  hardcodeado a `localhost:3001`, ahora lee `API_INTERNAL_URL`.

## 1. (Recomendado) Probar el build de produccion en tu maquina

Antes de subir nada a Dokploy, valida que los Dockerfiles compilan bien
(especialmente `canvas`/`tfjs-node`, que son dependencias nativas delicadas):

```bash
docker compose -f docker-compose.local-test.yml up --build
```

- Web: http://localhost:8080
- API: http://localhost:8081/api

Si el login funciona ahi (usuario admin de tu seed, o crea uno con
`POST /api/master/bootstrap-company` contra `MASTER_RESET_PASSWORD=local-test-master-password`),
el mismo build va a funcionar en Dokploy. Cuando termines:

```bash
docker compose -f docker-compose.local-test.yml down -v
```

## 2. Subir el codigo a GitHub

Esta carpeta ya es un repositorio git local (primer commit hecho). Falta
conectarla a un remoto:

1. Crea un repositorio vacio en GitHub (sin README/licencia, para que no
   choque con el commit local), por ejemplo `cerberus`.
2. Conecta y sube:

```bash
git remote add origin git@github.com:TU_USUARIO/cerberus.git
git branch -M main
git push -u origin main
```

Si usas HTTPS en vez de SSH, cambia la URL por
`https://github.com/TU_USUARIO/cerberus.git` (te va a pedir usuario/token).

**Importante**: revisa que `.env`, `apps/api/.env` y `apps/mobile/.env` NO
aparezcan en `git status` antes de este push (ya estan en `.gitignore`, pero
vale la pena confirmarlo — ahi vive tu `JWT_SECRET` y `MASTER_RESET_PASSWORD`
reales).

## 3. Crear la base de datos en Dokploy

En el dashboard de Dokploy:

1. **Projects** -> tu proyecto (o crea uno nuevo, ej. "cerberus") -> **Create
   Service** -> **Database** -> **PostgreSQL**.
2. Nombre: `cerberus-db`. Usuario/clave/DB: los que quieras (genera una clave
   fuerte, no "cerberus/cerberus").
3. Deploy. Cuando este arriba, entra al servicio y copia el **Internal
   Connection URL** (algo como
   `postgresql://usuario:clave@cerberus-db:5432/cerberus`) — esa es la que
   usaras como `DATABASE_URL`, NO la external (la external solo hace falta
   si vas a conectarte desde tu maquina con un cliente de Postgres).

## 4. Crear la aplicacion en Dokploy (Docker Compose)

1. **Create Service** -> **Compose**.
2. Conecta el repositorio de GitHub del paso 2 (Dokploy te pide autorizar la
   GitHub App si es la primera vez), rama `main`.
3. **Compose Path**: `docker-compose.yml` (el de la raiz, ya esta listo).
4. **Build Type**: deja el default (Dokploy construye las imagenes desde los
   Dockerfiles referenciados en el compose — no necesitas subir imagenes a
   ningun registry).

### Variables de entorno del compose

En la seccion **Environment** de este servicio compose, agrega (Dokploy las
inyecta a los `${VARIABLE}` que dejamos en `docker-compose.yml`):

```
DATABASE_URL=postgresql://usuario:clave@cerberus-db:5432/cerberus
JWT_SECRET=<genera uno largo y aleatorio, ej. openssl rand -hex 32>
JWT_EXPIRES_IN=8h
MASTER_RESET_PASSWORD=<otra clave larga y distinta, protege /master>
SMTP_HOST=
SMTP_USER=
SMTP_PASSWORD=
```

(`SMTP_*` puedes dejarlos vacios por ahora — el panel de Configuracion ->
Email tambien permite cargarlos despues desde la web, sin redeploy.)

### Dominios (Domains tab del servicio compose)

Dokploy deja asignar un dominio por **servicio** dentro del compose:

1. Servicio `web`, puerto `3000` -> Domain: `app.tudominio.com`, HTTPS
   automatico (Let's Encrypt) activado.
2. Servicio `api`, puerto `3000` -> Domain: `api.tudominio.com`, HTTPS
   automatico activado.

Antes de esto, en tu proveedor de DNS crea dos registros `A` (o `CNAME` si tu
proveedor de Dokploy lo maneja asi) apuntando `app` y `api` a la IP del
servidor de Dokploy.

### Deploy

Dale **Deploy**. La primera build tarda varios minutos (compila `canvas` y
descarga `tfjs-node`, son pesados). Sigue los logs desde el panel — al final
del log del servicio `api` deberias ver `Aplicando migraciones de
Prisma...` seguido de `Migraciones aplicadas. Iniciando API...`.

## 5. Verificar

```bash
curl -i https://api.tudominio.com/api/auth/login -X POST \
  -H "Content-Type: application/json" -d '{}'
# esperado: 400 (body invalido) -> confirma que la API responde

curl -i https://app.tudominio.com
# esperado: 200/307 -> confirma que el web responde
```

Entra a `https://app.tudominio.com`. Si la base de datos esta recien creada
(vacia), usa el panel maestro para sembrar la primera empresa+admin:

```bash
curl -X POST https://api.tudominio.com/api/master/bootstrap-company \
  -H "Content-Type: application/json" \
  -H "x-master-password: <tu MASTER_RESET_PASSWORD>" \
  -d '{"companyName": "...", "adminEmail": "...", "adminPassword": "...", ...}'
```

(revisa `apps/api/src/modules/master/master.controller.ts` para el shape
exacto del body que espera ese endpoint).

## 6. Fotos de marcaje (uploads) sobreviven a los redeploys

`docker-compose.yml` monta un volumen nombrado (`cerberus_uploads`) en
`/repo/apps/api/uploads` dentro del contenedor de la API. Dokploy conserva
los volumenes nombrados entre deploys/redeploys del mismo servicio, asi que
las fotos no se pierden al hacer push de un cambio nuevo. Si alguna vez
recreas el servicio compose desde cero (no un simple redeploy), revisa que el
volumen siga existiendo antes de asumir que las fotos van a seguir ahi.

## 7. App movil (Expo) apuntando a produccion

Edita `apps/mobile/.env`:

```
EXPO_PUBLIC_API_URL=https://api.tudominio.com/api
```

Esto solo afecta builds nuevos (Expo horna `EXPO_PUBLIC_*` en build time). Si
estas probando con Expo Go / dev client, basta con reiniciar
`npm run dev:mobile` para que tome el nuevo valor. Para un build real
(APK/IPA) vas a necesitar configurar `eas.json` con EAS Build — eso no esta
armado todavia en este repo; avisame cuando llegues a esa parte y lo dejamos
listo.

## 8. Cada vez que hagas un cambio

```bash
git add -A
git commit -m "..."
git push
```

Con el repo conectado, Dokploy puede redesplegar automaticamente en cada
push a `main` (activalo en **Settings -> Auto Deploy** del servicio compose),
o puedes darle **Deploy** manualmente desde el dashboard cuando quieras.
