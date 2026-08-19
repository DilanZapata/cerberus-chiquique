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
# next.config.js (server-side, runtime) el que hace el proxy hacia la API real.
ENV NEXT_PUBLIC_API_URL=/api
RUN npm run build --workspace packages/shared-types \
    && npm run build --workspace apps/web

FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/package.json ./package.json
COPY --from=build /repo/packages/shared-types/dist ./packages/shared-types/dist
COPY --from=build /repo/packages/shared-types/package.json ./packages/shared-types/package.json
COPY --from=build /repo/apps/web/.next ./apps/web/.next
COPY --from=build /repo/apps/web/public ./apps/web/public
COPY --from=build /repo/apps/web/package.json ./apps/web/package.json
COPY --from=build /repo/apps/web/next.config.js ./apps/web/next.config.js

EXPOSE 3000
ENV PORT=3000
CMD ["npm", "run", "start", "--workspace", "apps/web", "--", "-p", "3000"]
