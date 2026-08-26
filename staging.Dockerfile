# Legacy GitLab staging build retained temporarily for pipeline compatibility.
# Test and Production should both use the root Dockerfile and the same image.
FROM node:22-bookworm-slim AS base
ENV NODE_ENV=production
ENV COREPACK_HOME=/opt/corepack
ENV YARN_VERSION=4.18.0

# Install necessary packages
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*
RUN corepack enable

FROM base AS builder
WORKDIR /app

# Copy package files and install dependencies reproducibly
COPY package.json yarn.lock .yarnrc.yml ./
RUN yarn install --immutable

# Copy application files
COPY . .
ENV DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres_db

RUN yarn prisma generate && yarn build
RUN yarn workspaces focus --production && yarn cache clean --all

FROM base AS runner
WORKDIR /app

EXPOSE 4000
ENV PORT=4000
ENV TZ=Asia/Almaty

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 --ingroup nodejs nodejs \
  && chown nodejs:nodejs /app

COPY --chown=nodejs:nodejs --from=builder /app/package.json /app/yarn.lock /app/.yarnrc.yml ./
COPY --chown=nodejs:nodejs --from=builder /app/.yarn/install-state.gz ./.yarn/install-state.gz
COPY --chown=nodejs:nodejs --from=builder /app/dist/ ./dist
COPY --chown=nodejs:nodejs --from=builder /app/generated ./generated
COPY --chown=nodejs:nodejs --from=builder /app/src/prisma ./src/prisma
COPY --chown=nodejs:nodejs --from=builder /app/src/assets ./src/assets
COPY --chown=nodejs:nodejs --from=builder /app/prisma.config.ts ./prisma.config.ts
COPY --chown=nodejs:nodejs --from=builder /app/node_modules ./node_modules
COPY --from=builder /opt/corepack /opt/corepack

USER nodejs

HEALTHCHECK --interval=15s --timeout=15s --start-period=5s --retries=3 CMD [ "curl", "-f", "http://localhost:4000/api/v1/health" ]
CMD ["node", "dist/src/main"]
