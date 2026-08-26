import { prismaClient } from "./prisma-client";
import { EducationLevel, ProcessStep, SubscriptionTier } from "generated/prisma/enums";

export async function seedStudentPortrait() {
  const studentUser = await prismaClient.user.findUnique({
    where: { email: "student@oxusedu.com" },
  });

  if (!studentUser) {
    throw new Error("Seed user student@oxusedu.com not found");
  }

  const existingPortrait = await prismaClient.studentPortrait.findUnique({
    where: { userId: studentUser.id },
  });

  if (existingPortrait) {
    console.log("Student portrait already exists, skipping...");
    return;
  }

  await prismaClient.studentPortrait.create({
    data: {
      userId: studentUser.id,
      hasVisa: false,
      birthDate: new Date("2000-06-15T00:00:00.000Z"),
      educationLevel: EducationLevel.HIGH_SCHOOL,
      major: "Computer Science",
      gpa: 3.7,
      gpaScale: 4.0,
      budgetLimit: 15000,
      budgetCurrency: "USD",
      currentStep: ProcessStep.DISCOVERY,
      overallProgress: 10,
      subscription: SubscriptionTier.FREE,
      consultationBalance: 0,
      isIdentityLocked: false,
      generationCount: 0,
    },
  });

  console.log("Student portrait seeded successfully");
}
