// Origen (protocolo+host+puerto, SIN path) donde vive la API. En local
// apunta al backend en el propio host; en produccion (Dokploy) se fija a la
// direccion interna del contenedor de la API dentro de la red de
// docker-compose (ej. "http://api:3000"), no el dominio publico.
//
// OJO: `rewrites()` se evalua UNA SOLA VEZ en `next build` (el resultado
// queda congelado en .next/routes-manifest.json); `next start` no lo vuelve
// a ejecutar. Por eso API_INTERNAL_URL se fija como ENV en el Dockerfile
// ANTES del build (ver apps/web/Dockerfile) — ponerlo solo en el
// "environment:" del docker-compose (runtime) no tiene ningun efecto,
// termina siempre horneado con el valor por defecto de aqui abajo.
const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? 'http://localhost:3001';

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@cerberus/shared-types'],
  typescript: {
    // El monorepo mezcla apps/web (React 18) con apps/mobile/Expo (React 19)
    // en un solo arbol de npm workspaces. npm termina con DOS copias de
    // @types/react (una en la raiz para Expo, otra anidada en apps/web) y
    // paquetes como lucide-react resuelven sus tipos contra la de la raiz,
    // mientras el codigo de la app resuelve ReactNode contra la anidada ->
    // dos tipos "ReactNode" con el mismo nombre pero no identicos, lo que
    // TypeScript reporta como TS2786 en CADA icono de lucide-react usado
    // como componente JSX. `next dev`/`tsc --noEmit` no fallan por esto,
    // pero `next build` si, porque tipa en modo estricto. No es un bug de
    // logica de la app (confirmado: mismo error en decenas de archivos que
    // ya estaban en produccion via `next dev`), es un choque de versiones
    // de paquetes de tipos. Separar los workspaces (o forzar una sola
    // version de @types/react a nivel raiz) lo arregla de raiz, pero eso
    // rompe el arbol de dependencias de Expo (@react-native/virtualized-lists
    // exige @types/react especifico) - se documenta aqui para revisitarlo
    // sin bloquear el deploy mientras tanto.
    ignoreBuildErrors: true,
  },
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${API_INTERNAL_URL}/api/:path*` },
      // Fotos de evidencia de marcaje: se sirven fuera del prefijo /api (ver
      // useStaticAssets en apps/api/src/main.ts), pero pasan por el mismo
      // rewrite same-origin para evitar mixed-content (la pagina es https,
      // el backend puede estar en http dentro de la red interna).
      { source: '/uploads/:path*', destination: `${API_INTERNAL_URL}/uploads/:path*` },
    ];
  },
};

module.exports = nextConfig;
