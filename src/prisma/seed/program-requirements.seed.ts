import { prismaClient } from "./prisma-client";
import { RequirementType } from "generated/prisma/enums";

export async function seedProgramRequirements() {
  const programs = await prismaClient.program.findMany({
    select: { id: true, name: true, organisationId: true },
  });

  for (const program of programs) {
    const requirements = [
      {
        programId: program.id,
        type: RequirementType.TRANSCRIPT,
        title: "Academic Transcript",
        description: "Official transcript required for admission review",
        isRequired: true,
        sortOrder: 1,
      },
      {
        programId: program.id,
        type: RequirementType.PASSPORT,
        title: "Passport Copy",
        description: "Valid passport identification page",
        isRequired: true,
        sortOrder: 2,
      },
      {
        programId: program.id,
        type: RequirementType.SOP,
        title: "Statement of Purpose",
        description: "Motivation letter / SOP",
        isRequired: true,
        sortOrder: 3,
      },
      {
        programId: program.id,
        type: RequirementType.CV,
        title: "CV / Resume",
        description: "Latest academic or professional resume",
        isRequired: false,
        sortOrder: 4,
      },
    ];

    for (const req of requirements) {
      await prismaClient.programRequirement.upsert({
        where: {
          programId_type_title: {
            programId: req.programId,
            type: req.type,
            title: req.title,
          },
        },
        update: {
          description: req.description,
          isRequired: req.isRequired,
          sortOrder: req.sortOrder,
        },
        create: req,
      });
    }
  }

  console.log("✅ Program requirements seeded");
}
