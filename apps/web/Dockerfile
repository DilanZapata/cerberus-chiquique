# syntax=docker/dockerfile:1
#
# Build context es la RAIZ del monorepo (npm workspaces):
#   docker build -f apps/web/Dockerfile .

FROM node:20-alpine AS deps
WORKDIR /repo
COPY package.json package-lock.json ./
# npm necesita el package.json de CADA workspace declarado en el "workspaces"
# de la raiz (aunque no instalemos sus dependencias) para poder resolver el
# grafo contra package-lock.json; si falta alguno, `npm ci` falla.
COPY apps/web/package.json apps/web/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/mobile/package.json apps/mobile/package.json
COPY packages/cst-rules/package.json packages/cst-rules/package.json
COPY packages/shared-types/package.json packages/shared-types/package.json
RUN npm ci --workspace apps/web --workspace packages/shared-types --include-workspace-root

FROM deps AS build
COPY packages/shared-types packages/shared-types
COPY apps/web apps/web
# NEXT_PUBLIC_* se hornea en el bundle en build time. Queda fijo en "/api"
# (mismo origen) para que la MISMA imagen sirva en cualquier ambiente sin
# reconstruir: el navegador siempre pide /api/* a su propio dominio, y es
# next.config.js el que hace el proxy hacia la API real.
ENV NEXT_PUBLIC_API_URL=/api
# OJO: next.config.js calcula el destino de los rewrites (API_INTERNAL_URL)
# EN BUILD TIME, no en runtime -- `next build` congela el resultado de
# rewrites() en .next/routes-manifest.json y `next start` ya no vuelve a
# llamar esa funcion. Poner API_INTERNAL_URL solo en el "environment:" del
# docker-compose (runtime) NO tiene ningun efecto: queda horneado con el
# valor por defecto del next.config.js (http://localhost:3001), que dentro
# del contenedor no existe -> ECONNREFUSED. Por eso se fija aqui, ANTES del
# build. "api" es el nombre del servicio en docker-compose.yml -- Docker
# Compose lo resuelve por DNS interno al contenedor de la API.
ENV API_INTERNAL_URL=http://api:3000
RUN npm run build --workspace packages/shared-types \
    && npm run build --workspace apps/web

FROM node:20-alpine AS runtime
# Mismo motivo que en apps/api/Dockerfile: sin esto el contenedor corre en
# UTC en vez de hora de Colombia, y cualquier formateo de fechas que Next
# haga en el servidor (SSR) quedaria desfasado 5 horas.
RUN apk add --no-cache tzdata
ENV TZ=America/Bogota
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/package.json ./package.json
# npm anida "next"/"react"/"react-dom" DENTRO de apps/web/node_modules (no en
# la raiz) porque su version choca con la de apps/mobile/Expo mas arriba en
# el arbol de workspaces. Sin esta copia el contenedor arranca sin el
# binario de next y crashea en loop (exit 127, "command not found").
COPY --from=build /repo/apps/web/node_modules ./apps/web/node_modules
COPY --from=build /repo/packages/shared-types/dist ./packages/shared-types/dist
COPY --from=build /repo/packages/shared-types/package.json ./packages/shared-types/package.json
COPY --from=build /repo/apps/web/.next ./apps/web/.next
COPY --from=build /repo/apps/web/public ./apps/web/public
COPY --from=build /repo/apps/web/package.json ./apps/web/package.json
COPY --from=build /repo/apps/web/next.config.js ./apps/web/next.config.js

EXPOSE 3000
ENV PORT=3000
CMD ["npm", "run", "start", "--workspace", "apps/web", "--", "-p", "3000"]
