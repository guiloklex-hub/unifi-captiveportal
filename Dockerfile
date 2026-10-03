# syntax=docker/dockerfile:1.7
#
# Imagem de produção do UniFi Captive Portal.
#   docker compose up -d --build        (ver docker-compose.yml)
#
# Dados persistentes (SQLite + uploads) ficam em /data (volume).
# Migrações do Prisma rodam automaticamente no start.

ARG NODE_VERSION=24

FROM node:${NODE_VERSION}-bookworm-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

# ── Dependências ────────────────────────────────────────────────────────────
FROM base AS deps
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
# O postinstall roda `prisma generate`, que só precisa de uma DATABASE_URL válida.
# Proxy corporativo com CA própria: `docker build --secret id=ca,src=ca.pem ...`
RUN --mount=type=secret,id=ca,required=false \
    --mount=type=cache,target=/root/.npm \
    if [ -f /run/secrets/ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca; fi; \
    DATABASE_URL=file:/tmp/build.db npm ci --no-audit --no-fund

# ── Build (Next "standalone") ───────────────────────────────────────────────
FROM deps AS build
ARG GIT_SHA=""
ARG GIT_BRANCH=""
COPY . .
# Valores fictícios só para o build (as páginas são dinâmicas; nada conecta).
RUN NEXT_OUTPUT=standalone GIT_SHA="$GIT_SHA" GIT_BRANCH="$GIT_BRANCH" \
    DATABASE_URL=file:/tmp/build.db \
    ADMIN_SECRET=build-only-secret-with-at-least-32-characters \
    ADMIN_PASSWORD=build-only \
    UNIFI_URL=https://example.invalid \
    npm run build

# ── CLI do Prisma isolado, só para `migrate deploy` no start ────────────────
FROM deps AS prisma-cli
RUN mkdir -p /opt/prisma \
 && node -e "const l=require('./package-lock.json').packages;require('fs').writeFileSync('/opt/prisma/package.json',JSON.stringify({private:true,dependencies:{prisma:l['node_modules/prisma'].version,dotenv:l['node_modules/dotenv'].version}}))"
WORKDIR /opt/prisma
RUN --mount=type=secret,id=ca,required=false \
    --mount=type=cache,target=/root/.npm \
    if [ -f /run/secrets/ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca; fi; \
    npm install --omit=dev --no-audit --no-fund
# Sem --ignore-scripts: o postinstall baixa o schema engine AGORA — o container
# não depende de internet no boot para rodar as migrações.
COPY prisma.config.ts ./
COPY prisma ./prisma

# ── Runtime ─────────────────────────────────────────────────────────────────
# Obs.: a imagem slim não tem libssl; o Prisma avisa "failed to detect the
# libssl/openssl version" no boot, mas o schema engine (SQLite) funciona sem ela.
FROM base AS runner
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    DATABASE_URL=file:/data/portal.db \
    UPLOAD_DIR=/data/uploads

COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/src/build-info.json ./src/build-info.json
COPY --from=prisma-cli --chown=node:node /opt/prisma /opt/prisma
COPY --chown=node:node scripts/docker-entrypoint.sh scripts/docker-preflight.mts ./scripts/
RUN mkdir -p /data && chown node:node /data

USER node
EXPOSE 3000
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["sh", "scripts/docker-entrypoint.sh"]
