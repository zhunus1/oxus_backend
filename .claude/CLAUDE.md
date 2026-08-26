Project: OxusEdu
Stack: NestJS, PostgreSQL, Redis, MinIO


Project Structure:
- Application code: `src/`
- Tests: `tests/`
- Generated code (don't search): `dist/`, `generated`, `node_modules/`

Application Structure - What is inside `src/`:
  - `assets/` - logos, images for email, etc
  - `common/` - common dtos, helpers, validators, utils(Redis, Minio)
  - `configs/` - config files - messages
  - `database/` - Prisma ORM initialization, BaseRepository class and PrismaModule + PrismaService for NestJS DI
  - `prisma/` - Prisma ORM scheme, seeds, migrations
  - `app.module.ts` - main module for importing and initialization of others
  - `main.ts` - Main code for starting NestJS
  - `modules/` - Business Entity Modules with API dtos, controllers, services and repositories. Each folder in modules is one business logic entity