# syntax=docker/dockerfile:1

# ---------------------------------------------------------------- deps -----
# better-sqlite3 ships prebuilt binaries, but the toolchain is kept around so
# the image also builds on architectures without a prebuild (arm64 NAS, Pi...).
FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# -------------------------------------------------------------- runtime ----
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=8080 \
    DATABASE_PATH=/data/printer-queue.db
WORKDIR /app

RUN apt-get update \
 && apt-get install -y --no-install-recommends tini \
 && rm -rf /var/lib/apt/lists/*

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY public ./public
COPY scripts ./scripts

# Version affichée dans le dashboard et utilisée pour la sauvegarde automatique
# au premier démarrage d'une nouvelle version : le commit passé par
# scripts/update.sh, sinon une empreinte du code embarqué.
ARG GIT_SHA=unknown
ENV GIT_SHA=${GIT_SHA}
RUN find package.json src public scripts -type f | sort | xargs sha256sum | sha256sum | cut -c1-12 > BUILD_ID

# the named volume inherits this ownership on first mount
RUN mkdir -p /data && chown -R node:node /data /app

USER node
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "src/server.js"]
