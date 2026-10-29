# syntax=docker/dockerfile:1
# NEXUS API. Build from the repository root:
#   docker build -f apps/api/Dockerfile -t nexus-api .

# ---- build ----
FROM node:20-alpine AS build
WORKDIR /app
# mongodb-memory-server (tests only) would otherwise download a mongod binary.
ENV MONGOMS_DISABLE_POSTINSTALL=1
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --ignore-scripts --workspace @nexus/api --include-workspace-root
COPY packages/shared packages/shared
COPY apps/api apps/api
# tsup bundles @nexus/shared (raw TypeScript) into dist/server.js.
RUN npm run build -w @nexus/api

# ---- runtime ----
FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --ignore-scripts --omit=dev --workspace @nexus/api && npm cache clean --force
COPY --from=build /app/apps/api/dist apps/api/dist
WORKDIR /app/apps/api
# Local-disk uploads (used when Cloudinary is not configured); mount a volume here.
RUN mkdir -p uploads && chown node:node uploads
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4000/api/health/ready > /dev/null || exit 1
CMD ["node", "--enable-source-maps", "dist/server.js"]
