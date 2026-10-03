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

Current integration and operational guides are listed in [docs](docs/README.md), including [expert call email notifications](docs/lead-call-notifications.md).

### Frontend-calculated manual lead results

`POST /api/v1/sales/v2/leads` and `PATCH /api/v1/sales/v2/leads/:id/questionnaire` accept optional top-level `score` (integer 0–1000), `percent` (integer 0–100) and `universities` (integer 0–10000). Send all three together as JSON numbers to persist frontend results without recalculation. Partial sets, null, strings (including numeric strings) and booleans return 400. Omit all three to retain the existing server calculation during frontend migration.

```json
{
  "name": "Алихан Әлиев",
  "phone": "+7 700 000 00 01",
  "email": "student@example.test",
  "role": "student",
  "locale": "ru",
  "quizVersion": "2026-08-22",
  "answers": [{ "questionId": "city", "optionId": "almaty" }],
  "score": 20,
  "percent": 2,
  "universities": 2
}
```

For PATCH, omit the contact fields (`name`, `phone`, `email`). The frontend uses the same top-level result field names as the public calculator, but manual answers still use `optionId` and are validated against the supported questionnaire version. Supplied metrics are checked for ranges, not consistency with answers or each other. Questionnaire completeness and `provisional` remain server-controlled. Results are stored in both `LeadSubmission.metrics` and `normalizedPayload.questionnaire.metrics`; saving appends a snapshot and preserves history.

`POST /api/v1/sales/v2/questionnaires/calculator/preview` continues to calculate on the server for existing clients. The public calculator submission contract is unchanged. No database migration is needed for this change.

### Frontend-calculated Express results

`POST /api/v1/public/lead-sources/express/submissions` also accepts optional top-level `score`, `percent` and `universities` with the same ranges. Send all three together as JSON numbers; incomplete sets, null, strings and booleans return 400. Values are preserved exactly in `LeadSubmission.metrics` and in the accepted `rawPayload`; the server does not calculate or verify results against Express questionnaire answers. Omitting all three preserves the existing behavior: `metrics` remains null, with no server fallback calculation for Express.

```json
{
  "submissionId": "1bec4c5e-177d-4d1c-b8dd-4a580507523f",
  "submittedAt": "2026-10-03T09:00:00.000Z",
  "locale": "ru",
  "schoolName": "Школа № 125",
  "grade": 10,
  "lastName": "Әлиев",
  "firstName": "Алихан",
  "middleName": "Ерланұлы",
  "phone": "+7 700 000 00 01",
  "countryIds": [10, 20],
  "studyFields": ["IT", "ENGINEERING"],
  "score": 935,
  "percent": 93,
  "universities": 50
}
```

Country IDs and results above are illustrative; use actual country IDs and frontend-calculated values. Generate `submissionId` once per logical submission and reuse the complete body for retries. Reusing a UUID returns the original lead and does not update its metrics, even if different scores are supplied. `normalizedPayload` continues to hold the processed contacts and questionnaire fields; consumers read results from the submission's `metrics`. No additional schema migration is required.

### Manual expert contracts

The expert saves a contract draft without creating a student account. Paper signature and receipt of the full amount or first installment are confirmed manually; only then are the account, assignment and benefits created. New prices are 1,500,000 KZT, or 750,000 KZT for Cambridge Line. Monthly equal installments start on the actual first payment date.

Deploy migration `20260928130000_manual_contracts` before the application. Coordinate the frontend rollout: preparation now returns `contract: null` and `draft`. Online OTP/signing routes are temporarily disabled for all contracts. Existing records are preserved and can be completed manually.

See [manual contract API, frontend integration, private scans and deployment](docs/manual-contracts.md) for request examples, payment rules, legacy handling and tests.

Student identity uses separate `firstname`, `lastname`, optional `middlename`; parent identity is stored separately. Omitted, null or blank patronymics remain optional. Existing profile APIs keep their fields and identity-lock behavior; no full name is split automatically.
