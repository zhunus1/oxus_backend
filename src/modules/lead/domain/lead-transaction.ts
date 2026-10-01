import { ConflictException } from "@nestjs/common";
import { Prisma } from "generated/prisma/client";
import { PrismaService } from "src/database/prisma.service";

/** Runs database-only work at Serializable isolation, retrying conflicts up to three attempts and returning HTTP 409 on exhaustion. Do not send mail or emit events inside the callback. */
export async function leadTransaction<T>(prisma: PrismaService, operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await prisma.$transaction(operation, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      const failure = error as { code?: string; meta?: { code?: string; driverAdapterError?: { cause?: { originalCode?: string } } } };
      const sqlState = failure?.meta?.code ?? failure?.meta?.driverAdapterError?.cause?.originalCode;
      // Prisma wraps conflicts from SELECT FOR UPDATE in P2010 instead of P2034.
      const rawConflict = failure?.code === "P2010" && (sqlState === "40001" || sqlState === "40P01");
      if (failure?.code !== "P2034" && failure?.code !== "P2002" && !rawConflict) throw error;
      if (attempt === 2) throw new ConflictException("The lead or booking changed concurrently. Refresh and retry.");
    }
  }
  throw new Error("Unreachable transaction retry state");
}
