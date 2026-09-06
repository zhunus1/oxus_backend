import { ConflictException } from "@nestjs/common";
import { Prisma } from "generated/prisma/client";
import { PrismaService } from "src/database/prisma.service";

/** Runs database-only work at Serializable isolation, retrying conflicts up to three attempts and returning HTTP 409 on exhaustion. Do not send mail or emit events inside the callback. */
export async function leadTransaction<T>(prisma: PrismaService, operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await prisma.$transaction(operation, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      const code = (error as { code?: string })?.code;
      if (code !== "P2034" && code !== "P2002") throw error;
      if (attempt === 2) throw new ConflictException("The lead or booking changed concurrently. Refresh and retry.");
    }
  }
  throw new Error("Unreachable transaction retry state");
}
