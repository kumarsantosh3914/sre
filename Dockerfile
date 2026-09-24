# syntax=docker/dockerfile:1.7
# One image recipe for every NestJS service:
#   docker build --build-arg SERVICE=api-gateway -t sreai-api-gateway .
# Stages: fetch deps (cached on the lockfile) → build the service and the
# workspace packages it depends on → `pnpm deploy` a pruned, production-only
# bundle → copy just that into a minimal non-root runtime image.

ARG NODE_VERSION=20

FROM node:${NODE_VERSION}-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /repo

FROM base AS deps
# Toolchain only for native modules without a prebuilt musl binary.
RUN apk add --no-cache python3 make g++
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm fetch

FROM deps AS build
ARG SERVICE
RUN test -n "$SERVICE" || (echo "--build-arg SERVICE is required" && exit 1)
COPY tsconfig.base.json .eslintrc.js ./
# All workspace manifests must be present for a frozen, filtered install
# against the shared lockfile; only the target service is built.
COPY packages ./packages
COPY apps ./apps
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --offline --frozen-lockfile --filter "@sreai/${SERVICE}..."
RUN pnpm --filter "@sreai/${SERVICE}..." run build
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm deploy --filter "@sreai/${SERVICE}" --prod --legacy /out

FROM node:${NODE_VERSION}-alpine AS runtime
ARG SERVICE
ENV NODE_ENV=production \
    SERVICE=${SERVICE}
RUN apk add --no-cache tini && addgroup -S app && adduser -S app -G app
WORKDIR /app
COPY --from=build --chown=app:app /out ./
USER app
EXPOSE 3000 3001 3002 3003
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "const p={'api-gateway':3000,'ingestion-service':3001,'diagnosis-service':3002,'action-service':3003}[process.env.SERVICE];require('http').get('http://127.0.0.1:'+(process.env.PORT_OVERRIDE||p)+'/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"
# tini: correct signal handling so Nest's shutdown hooks (queue consumers,
# BullMQ workers) drain on `docker stop`.
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
