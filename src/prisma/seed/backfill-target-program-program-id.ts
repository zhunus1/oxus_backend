import { prismaClient } from "./prisma-client";

async function main() {
  const targets = await prismaClient.targetProgram.findMany({
    where: { programId: null },
    select: {
      id: true,
      programTitle: true,
      organisationId: true,
    },
  });

  for (const target of targets) {
    const program = await prismaClient.program.findFirst({
      where: {
        organisationId: target.organisationId,
        name: target.programTitle,
      },
      select: {
        id: true,
        name: true,
      },
    });

    if (!program) {
      console.log(`SKIPPED targetProgram ${target.id}: no matching Program for "${target.programTitle}" in organisation ${target.organisationId}`);
      continue;
    }

    await prismaClient.targetProgram.update({
      where: { id: target.id },
      data: { programId: program.id },
    });

    console.log(`UPDATED targetProgram ${target.id} -> programId ${program.id} (${program.name})`);
  }

  await prismaClient.$disconnect();
}

main().catch(async error => {
  console.error(error);
  await prismaClient.$disconnect();
  process.exit(1);
});
