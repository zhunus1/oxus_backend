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

Changes go through `feature/*` → PR to `test` → Test deployment → PR to `main` → Production deployment.

- PRs run lint, tests and application/Docker builds without deploying.
- Pushes to `test` publish `ghcr.io/zhunus1/oxus_backend:test` and `:sha-<commit>`, then deploy the exact image digest to Test.
- Pushes to `main` automatically promote an already successful Test image whose source files exactly match `main`. Production does not rebuild the image or follow a mutable tag.
- Each server keeps its own `.env`, Jitsi key, Compose configuration, database and media. Production gets a database backup before migrations; CI never imports Test data into Production.

Deployment scripts and release verification live in `deployment/`. Before activating the workflows, install the updated server script on both servers and configure two SSH secrets in each GitHub environment (`test` and `production`). See [deployment setup, secrets and recovery](deployment/README.md).

## Sales Manager CRM

The backend contract for landing-calculator ingestion, Sales Manager ownership, callbacks, expert calls, notifications, and realtime events is documented in [`docs/sales-manager-crm.md`](docs/sales-manager-crm.md).

### Manual expert contracts

The expert saves a contract draft without creating a student account. Paper signature and receipt of the full amount or first installment are confirmed manually; only then are the account, assignment and benefits created. New prices are 1,500,000 KZT, or 750,000 KZT for Cambridge Line. Monthly equal installments start on the actual first payment date.

Deploy migration `20260928130000_manual_contracts` before the application. Coordinate the frontend rollout: preparation now returns `contract: null` and `draft`. Online OTP/signing routes are temporarily disabled for all contracts. Existing records are preserved and can be completed manually.

See [manual contract API, frontend integration, private scans and deployment](deployment/manual-contracts.md) for request examples, payment rules, legacy handling and tests.

Student identity uses separate `firstname`, `lastname`, optional `middlename`; parent identity is stored separately. Omitted, null or blank patronymics remain optional. Existing profile APIs keep their fields and identity-lock behavior; no full name is split automatically.
