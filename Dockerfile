# syntax=docker/dockerfile:1.7

ARG BUN_VERSION=1.4.2

FROM oven/bun:${BUN_VERSION}-alpine AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM deps AS build
WORKDIR /app
COPY . .

ARG VITE_RUNTIME_BACKEND=supabase
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_PUBLISHABLE_KEY

ENV NODE_ENV=production \
    NITRO_PRESET=node-server \
    VITE_RUNTIME_BACKEND=${VITE_RUNTIME_BACKEND} \
    VITE_SUPABASE_URL=${VITE_SUPABASE_URL} \
    VITE_SUPABASE_PUBLISHABLE_KEY=${VITE_SUPABASE_PUBLISHABLE_KEY}

RUN if [ "$VITE_RUNTIME_BACKEND" != "postgres" ]; then \
      test -n "$VITE_SUPABASE_URL" && \
      test -n "$VITE_SUPABASE_PUBLISHABLE_KEY"; \
    fi \
    && bun run build \
    && test -f .output/server/index.mjs

FROM deps AS migrate
WORKDIR /app
COPY scripts ./scripts
COPY drizzle/migrations ./drizzle/migrations
COPY drizzle/bootstrap ./drizzle/bootstrap
ENV NODE_ENV=production \
    MIGRATIONS_DIR=/app/drizzle/migrations
CMD ["bun", "scripts/migrate.mjs"]

FROM node:22-alpine AS runtime
RUN apk add --no-cache tini \
    && mkdir -p /data/storage \
    && chown -R node:node /data

WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000

COPY --from=build --chown=node:node /app/.output ./.output

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", ".output/server/index.mjs"]
