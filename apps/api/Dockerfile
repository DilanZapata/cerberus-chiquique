# syntax=docker/dockerfile:1
#
# Build context es la RAIZ del monorepo (npm workspaces), no apps/api:
#   docker build -f apps/api/Dockerfile .
# Dokploy hace esto automaticamente cuando el docker-compose.yml de la raiz
# apunta a este Dockerfile con context: .

# ---- base: solo las librerias de sistema que canvas/tfjs-node necesitan EN
# RUNTIME (sin headers de compilacion, para que la imagen final sea liviana) ----
FROM node:20-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends \
    libcairo2 libpango-1.0-0 libpangocairo-1.0-0 libjpeg62-turbo libgif7 librsvg2-2 libpixman-1-0 \
    openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# ---- deps: instala TODAS las dependencias (incluye devDependencies, porque
# el CLI de prisma para "migrate deploy" vive ahi) con los headers de
# compilacion que canvas necesita para su addon nativo ----
FROM base AS deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ pkg-config \
    libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /repo
COPY package.json package-lock.json ./
# npm necesita el package.json de CADA workspace declarado en el "workspaces"
# de la raiz (aunque no instalemos sus dependencias) para poder resolver el
# grafo contra package-lock.json; si falta alguno, `npm ci` falla.
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/mobile/package.json apps/mobile/package.json
COPY packages/cst-rules/package.json packages/cst-rules/package.json
COPY packages/shared-types/package.json packages/shared-types/package.json
RUN npm ci --workspace apps/api --workspace packages/cst-rules --workspace packages/shared-types --include-workspace-root

# ---- build: compila shared-types -> cst-rules -> api (en ese orden, api
# depende de los otros dos). El cliente de Prisma se genera ANTES de "nest
# build": el codigo de la API importa tipos/enums (UserRole, TimeLogType...)
# que Prisma agrega a @prisma/client en ese paso, asi que si se genera
# despues, "nest build" falla porque esos tipos todavia no existen. ----
FROM deps AS build
COPY packages/shared-types packages/shared-types
COPY packages/cst-rules packages/cst-rules
COPY apps/api apps/api
RUN npx prisma generate --schema apps/api/prisma/schema.prisma \
    && npm run build --workspace packages/shared-types \
    && npm run build --workspace packages/cst-rules \
    && npm run build --workspace apps/api

# ---- runtime: imagen final. Se preserva la MISMA estructura de carpetas del
# monorepo (node_modules en la raiz con los symlinks @cerberus/* intactos)
# porque asi es como npm workspaces resuelve los paquetes locales ----
FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/package.json ./package.json
COPY --from=build /repo/packages/shared-types/dist ./packages/shared-types/dist
COPY --from=build /repo/packages/shared-types/package.json ./packages/shared-types/package.json
COPY --from=build /repo/packages/cst-rules/dist ./packages/cst-rules/dist
COPY --from=build /repo/packages/cst-rules/package.json ./packages/cst-rules/package.json
COPY --from=build /repo/apps/api/dist ./apps/api/dist
COPY --from=build /repo/apps/api/package.json ./apps/api/package.json
COPY --from=build /repo/apps/api/prisma ./apps/api/prisma
COPY --from=build /repo/apps/api/models ./apps/api/models
COPY apps/api/docker-entrypoint.sh ./apps/api/docker-entrypoint.sh
RUN mkdir -p /repo/apps/api/uploads && chmod +x /repo/apps/api/docker-entrypoint.sh

WORKDIR /repo/apps/api
EXPOSE 3000
ENTRYPOINT ["./docker-entrypoint.sh"]
