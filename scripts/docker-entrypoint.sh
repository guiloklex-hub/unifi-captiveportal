#!/bin/sh
# Entrada do container: aplica migrações pendentes e sobe o servidor Next.js
# (build "standalone"). O CLI do Prisma fica isolado em /opt/prisma.
set -e

# Valida/normaliza o ambiente (aspas, DATABASE_URL, ADMIN_SECRET) — ver o script.
preflight=$(node scripts/docker-preflight.mts) || exit 1
eval "$preflight"

mkdir -p "${UPLOAD_DIR:-/data/uploads}"

echo "[entrypoint] aplicando migrações do banco…"
(cd /opt/prisma && node node_modules/prisma/build/index.js migrate deploy)

echo "[entrypoint] iniciando na porta ${PORT:-3000}"
# client-ip.cjs: IP real do cliente (ignora X-Real-IP/X-Forwarded-For forjados).
exec node --require ./scripts/client-ip.cjs server.js
