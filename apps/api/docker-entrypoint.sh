#!/bin/sh
# Aplica las migraciones pendientes de Prisma antes de arrancar. Reintenta en
# caso de que la base de datos administrada por Dokploy todavia no acepte
# conexiones en el primer arranque del contenedor.
set -e

echo "Aplicando migraciones de Prisma..."
attempt=0
until npx prisma migrate deploy; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 10 ]; then
    echo "No se pudo migrar la base de datos tras $attempt intentos. Abortando."
    exit 1
  fi
  echo "La base de datos no esta lista todavia, reintentando en 3s (intento $attempt/10)..."
  sleep 3
done

echo "Migraciones aplicadas. Iniciando API..."
exec node dist/main.js
