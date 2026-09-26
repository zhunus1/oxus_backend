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

### Student name when preparing a CRM contract

`POST /api/v1/expert/leads/:leadId/contract` accepts separate student name fields:

| Field | Required | Meaning |
| --- | --- | --- |
| `lastname` | Yes | Family name |
| `firstname` | Yes | Given name |
| `middlename` | No | Patronymic, up to 100 characters after trimming |

The other contract fields (email, phone, tariff, price and currency) remain required as before. For a parent lead, these name fields belong to the student, not the parent. No full-name string is split automatically.

Omitted, `null`, empty or whitespace-only patronymics are stored as `null` for new accounts. Existing requests without `middlename` remain valid. Reusing a matching student still requires explicit `existingStudentId` confirmation: preparation only fills a missing patronymic on an unlocked identity; it never overwrites a saved patronymic or changes a locked identity. Retrying an already prepared contract does not update the name.

The student's `middlename` is returned with the user profile (`GET /api/v1/auth/me`), in `contract.student` from the contract detail/list endpoints, and in expert student lists. The preparation response retains its existing contract summary; read the student's name via `GET /api/v1/contracts/student/:studentId`. `PATCH /api/v1/account/me` accepts the same optional field: omission preserves the current value, while `null` or a blank string clears it.

Student signing still accepts the existing `clientFullName` and `studentName` strings. The frontend can join the separate name fields for those strings, omitting an absent patronymic; parent signer details remain separate from the student's profile.

Deploy migration `20260916160000_add_user_middlename` before starting the new backend. It adds a nullable column without changing existing names. When rolling back application code, retain the column to preserve saved patronymics.
