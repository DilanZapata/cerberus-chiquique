# Levantar el proyecto en local

## Requisitos

- Node.js 18+
- Docker (para PostgreSQL) — o un Postgres local propio
- Expo Go en tu telefono, o un simulador iOS/Android, si vas a probar mobile

## 1. Instalar dependencias

Desde la raiz del repo (es un monorepo con npm workspaces, un solo `install`
alcanza para las 3 apps y los 2 packages):

```bash
npm install
```

## 2. Base de datos

```bash
docker compose up -d postgres
```

Esto levanta Postgres en `localhost:5432` con las credenciales que ya estan
en `docker-compose.yml` (`cerberus`/`cerberus`/`cerberus`).

## 3. Configurar variables de entorno del API

`apps/api/.env` (copia de `.env.example` si no existe):

```
DATABASE_URL=postgresql://cerberus:cerberus@localhost:5432/cerberus?schema=public
JWT_SECRET=change-me
JWT_EXPIRES_IN=8h
```

## 4. Migraciones + Prisma Client

```bash
npm run prisma:migrate --workspace apps/api
npm run prisma:generate --workspace apps/api
```

Si el repo ya trae un `seed.ts` o script de datos de ejemplo, correrlo antes
de probar login (revisa `apps/api/prisma/` para el seed vigente).

## 5. Levantar el backend

```bash
npm run dev:api
```

Por defecto en `http://localhost:3001` (`PORT=3001` en `.env` de este
entorno; `.env.example` trae `3000` como valor de referencia — ajustalo si
lo cambias). El prefijo global de rutas es `/api`, ej.
`http://localhost:3001/api/auth/login`.

## 6. Levantar la web

```bash
npm run dev:web
```

El script de `apps/web` usa HTTPS local (`--experimental-https`) con
certificados en `apps/web/certificates/` — abre
`https://localhost:3000` (acepta el certificado autofirmado la primera vez).
`apps/web/.env.local` debe apuntar `NEXT_PUBLIC_API_URL` (o equivalente) al
backend.

## 7. Levantar mobile

```bash
npm run dev:mobile
```

Abre el QR con Expo Go, o presiona `i`/`a` para simulador iOS/Android.
`apps/mobile/.env` debe apuntar la URL del API a la **IP LAN** de tu
maquina (no `localhost`), porque el telefono/simulador no comparte el
loopback de tu computadora.

## Kiosco vs App de empleado

No hace falta un dispositivo fisico por rol para probar todo: la misma app
mobile tiene "Modo Kiosco" (sin login, terminal compartida por PIN o rostro)
e "Iniciar sesion" (sesion personal, ve dashboard/gestion si es admin, o
pantalla de marcaje GPS si es empleado) — ver `architecture.md`.

## Verificar que todo esta arriba

```bash
pg_isready -h localhost -p 5432
curl -s http://localhost:3001/api/companies/me   # 401 sin token = backend vivo
curl -sk https://localhost:3000                  # web sirviendo
```

Un 401 en `/companies/me` sin token es la respuesta esperada — confirma que
el guard de auth esta activo, no es un error.
