import "dotenv/config";
import "reflect-metadata";
import { PrismaService } from "src/database/prisma.service";
import { DEMO_TIMEZONE, parseDemoOptions } from "./sales-expert-demo.plan";
import { seedSalesExpertDemo } from "./sales-expert-demo.seed";

async function main() {
  const now = new Date();
  const options = parseDemoOptions(process.argv.slice(2), process.env, now);
  const prisma = new PrismaService();
  try {
    const result = await seedSalesExpertDemo(prisma, options, now);
    console.log(JSON.stringify({ ...result, timezone: DEMO_TIMEZONE }, null, 2));
    console.log(
      options.apply
        ? "Demo data committed. Refresh Sales and Expert. Rerunning for the same accounts today preserves progress; a later day creates a new three-day batch."
        : "Read-only preview. Add --apply to create the missing scenarios.",
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  // Prisma connection errors can contain connection details; only report their code.
  const prismaError = error as { name?: string; code?: string };
  console.error(
    prismaError.name?.startsWith("Prisma")
      ? `Demo seed failed (${prismaError.code ?? prismaError.name}); transaction rolled back.`
      : error instanceof Error
        ? error.message
        : "Demo seed failed",
  );
  process.exitCode = 1;
});
