# Local-development image with the full toolchain required for hot reload.
# Do not use this image for Test or Production deployments.
FROM node:22-bookworm-slim

ENV NODE_ENV=development
ENV COREPACK_HOME=/opt/corepack
ENV YARN_VERSION=4.18.0
ENV PORT=4000
ENV TZ=Asia/Almaty

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    fonts-noto \
    openssl \
    pkg-config \
    procps \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable

COPY package.json yarn.lock .yarnrc.yml ./
RUN yarn install --immutable

COPY . .
RUN DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres yarn prisma generate
RUN chown -R node:node /app /opt/corepack

EXPOSE 4000

USER node

CMD ["yarn", "start:dev"]
