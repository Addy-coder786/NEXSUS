# syntax=docker/dockerfile:1
# NEXUS web app: static build served by nginx, which also proxies /api, /socket.io and /uploads
# to the API so the browser talks to one origin (cookies stay same-site). Build from the root:
#   docker build -f apps/web/Dockerfile -t nexus-web .

# ---- build ----
FROM node:20-alpine AS build
WORKDIR /app
ENV MONGOMS_DISABLE_POSTINSTALL=1
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --ignore-scripts --workspace @nexus/web --include-workspace-root
COPY packages/shared packages/shared
COPY apps/web apps/web
# Empty = same origin through the nginx proxy. Set it to call a separate API host instead.
ARG VITE_API_URL=
ENV VITE_API_URL=${VITE_API_URL}
RUN npm run build -w @nexus/web

# ---- runtime ----
FROM nginx:1.27-alpine AS runtime
COPY apps/web/nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
# The template is rendered at start-up; API_UPSTREAM defaults to the compose service name.
ENV API_UPSTREAM=http://api:4000
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1/healthz > /dev/null || exit 1
