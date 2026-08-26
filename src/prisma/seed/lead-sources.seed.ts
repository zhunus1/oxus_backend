import { prismaClient } from "./prisma-client";

const leadSources = [
  { id: 1, code: "legacy-contact-form", name: "Legacy contact form" },
  { id: 2, code: "landing-calculator", name: "Landing calculator" },
  { id: 3, code: "office-manual", name: "Office manual entry" },
];

export async function seedLeadSources() {
  for (const source of leadSources) {
    await prismaClient.leadSource.upsert({
      where: { code: source.code },
      update: { name: source.name, isActive: true },
      create: { ...source, isActive: true },
    });
  }
}
