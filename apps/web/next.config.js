// Origen (protocolo+host+puerto, SIN path) donde vive la API. En local
// apunta al backend en el propio host; en produccion (Dokploy) se sobreescribe
// con la variable de entorno API_INTERNAL_URL, normalmente la direccion
// interna del contenedor de la API dentro de la red de docker-compose
// (ej. "http://api:3000"), no el dominio publico. Se lee en runtime (no es
// NEXT_PUBLIC_*), asi que un mismo build sirve para cualquier ambiente con
// solo cambiar esta variable, sin reconstruir la imagen.
const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? 'http://localhost:3001';

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@cerberus/shared-types'],
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
