# syntax=docker/dockerfile:1.7
#   docker build -f apps/dashboard/Dockerfile -t sreai-dashboard .
ARG NODE_VERSION=20

FROM node:${NODE_VERSION}-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /repo

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm fetch
COPY packages ./packages
COPY apps ./apps
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --offline --frozen-lockfile --filter "@sreai/dashboard..."
# The API/socket base URLs are same-origin paths behind nginx by default;
# override at build time for split deployments.
ARG NEXT_PUBLIC_API_URL=/api
ARG NEXT_PUBLIC_REALTIME_URL=
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL} NEXT_PUBLIC_REALTIME_URL=${NEXT_PUBLIC_REALTIME_URL}
RUN pnpm --filter @sreai/dashboard run build

FROM node:${NODE_VERSION}-alpine AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3100 HOSTNAME=0.0.0.0
RUN apk add --no-cache tini && addgroup -S app && adduser -S app -G app
WORKDIR /app
COPY --from=build --chown=app:app /repo/apps/dashboard/.next/standalone ./
COPY --from=build --chown=app:app /repo/apps/dashboard/.next/static ./apps/dashboard/.next/static
COPY --from=build --chown=app:app /repo/apps/dashboard/public ./apps/dashboard/public
USER app
EXPOSE 3100
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "apps/dashboard/server.js"]
