# OxusEdu backend

NestJS backend for the OxusEdu platform. The project uses Node.js 22, Yarn 4 through Corepack, PostgreSQL, Redis, Prisma, BullMQ, MinIO, and Browserless.

## Run locally with Docker

Docker is the recommended local-development setup. It uses isolated development credentials and does not pass values from the repository's `.env` into the containers.

```bash
docker compose up --build
```

This starts:

- the backend with file watching on <http://localhost:4000>;
- PostgreSQL on `127.0.0.1:55432`;
- Redis on `127.0.0.1:56379`;
- MinIO API on <http://localhost:9000> and console on <http://localhost:9090>;
- Browserless on `127.0.0.1:3003`;
- a one-shot Prisma migration container;
- a one-shot development Jitsi-key generator.

The API prefix is `/api/v1`, and the health endpoint is <http://localhost:4000/api/v1/health>.

Useful commands:

```bash
# Start in the background
docker compose up --build -d

# Check health and container status
docker compose ps

# Follow backend logs
docker compose logs -f backend

# Apply newly added migrations
docker compose run --rm migrator

# Stop containers while preserving database and object-storage data
docker compose down

# Delete all local Docker data and start from an empty database
docker compose down -v
```

Source files are mounted into the backend container, so Nest reloads after TypeScript changes. `node_modules`, generated Prisma code, database files, MinIO data, and the local Jitsi key remain in Docker volumes. Compiled output is written to the ignored local `dist/` directory.

If a default host port is already occupied, override it for that command, for example:

```bash
LOCAL_BACKEND_PORT=4100 LOCAL_POSTGRES_PORT=56432 docker compose up --build
```

### Environment file roles

- Root `.env` is for running Nest directly on the host. Docker Compose also reads its `LOCAL_*` values for published host ports, but does not inject the file into the backend container.
- Root `.env.example` is the safe, copy-ready local template.
- `deployment/.env` is required for server deployments and must contain the real server configuration.
- `deployment/.env.example` is the deployment template. The deploy script never falls back to the local root `.env`.

## Run without Docker

Install Node.js 22 and enable the Yarn version pinned in `package.json`:

```bash
corepack enable
yarn --version
yarn install --immutable
cp .env.example .env
```

You may still use Docker for the infrastructure, then run Nest on the host:

```bash
docker compose up -d db redis minio chrome
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out src/assets/jitsi-private-key.pk
yarn prisma generate
yarn prisma migrate dev
yarn start:dev
```

The expected Yarn version is `4.18.0`. Do not use npm or pnpm, and do not add their lockfiles.

If an older global Yarn intercepts the command before Corepack is enabled, use `corepack yarn` in place of `yarn`.

## Quality checks

```bash
yarn lint
yarn test
yarn test:e2e
yarn test:cov
yarn build
```

## Deployment

Deployment configuration is stored in `deployment/`. The current server stack is intentionally backend-only: backend, PostgreSQL, Redis, MinIO, Browserless, and a one-shot Prisma migrator. Frontend applications are deployed separately when their source repositories are available.

Successful pushes to `main` publish two image tags to GitHub Container Registry:

- `ghcr.io/zhunus1/oxus_backend:test` for the current Test release;
- `ghcr.io/zhunus1/oxus_backend:sha-<commit>` for an immutable commit-specific release.

On the server, copy `deployment/.env.example` to `deployment/.env`, replace every placeholder with server-specific values, add `deployment/jitsi-private-key.pk`, authenticate Docker to GHCR, and run:

```bash
./deployment/deploy.sh
```

The deploy script validates the Compose configuration, pulls images, applies Prisma migrations, starts the stack, and fails if the backend health endpoint does not become ready within three minutes. Host Nginx forwards `/api` to the backend and `/storage` to MinIO; `/` returns `503` until a frontend is deployed.

See [`deployment/README.md`](deployment/README.md) for the first Test deployment, GHCR login, HTTPS setup, updates, and rollback procedure.

## Sales Manager CRM

The backend contract for landing-calculator ingestion, Sales Manager ownership, callbacks, expert calls, notifications, and realtime events is documented in [`docs/sales-manager-crm.md`](docs/sales-manager-crm.md).
