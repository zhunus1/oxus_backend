import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "src/prisma/schema.prisma",
  migrations: {
    path: "src/prisma/migrations",
    seed: "node dist/src/prisma/seed/seed.js",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
