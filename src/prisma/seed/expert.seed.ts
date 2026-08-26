import * as bcrypt from "bcrypt";
import { prismaClient } from "./prisma-client";
import { ApplicationStatus, DocumentStatus, EducationLevel, ProcessStep, RequirementType, SubscriptionTier } from "generated/prisma/enums";

type OrganisationSeed = {
  slug: string;
  programTitle: string;
  degreeLevel: string;
  intake: string;
};

async function upsertUser(args: { email: string; phoneNumber: string; firstname: string; lastname: string; roleId: number; passwordHash: string }) {
  const { email, phoneNumber, firstname, lastname, roleId, passwordHash } = args;
  return prismaClient.user.upsert({
    where: { email },
    update: {},
    create: {
      firstname,
      lastname,
      email,
      phoneNumber,
      password: passwordHash,
      roleId,
    },
  });
}

async function ensureConsultantProfile(params: { expertEmail: string }) {
  const { expertEmail } = params;

  const expertUser = await prismaClient.user.findUnique({ where: { email: expertEmail } });
  if (!expertUser) {
    throw new Error(`Expert user not found for email=${expertEmail}`);
  }

  // Pick countries that exist in your `country.seed.ts`
  const expertCountryIsoCodes = ["DE", "US", "GB", "KZ"];
  const countries = await prismaClient.country.findMany({
    where: { isoCode: { in: expertCountryIsoCodes } },
    select: { id: true },
  });
  if (countries.length === 0) {
    throw new Error("No countries found for expert seed (check country.seed.ts)");
  }

  const countryIds = countries.map(c => c.id);

  return prismaClient.consultantProfile.upsert({
    where: { userId: expertUser.id },
    create: {
      userId: expertUser.id,
      bio: "Admissions strategy consultant",
      rating: 4.8,
      successRate: 72,
      isActive: true,
      expertCountries: { connect: countryIds.map(id => ({ id })) },
    },
    update: {
      bio: "Admissions strategy consultant",
      rating: 4.8,
      successRate: 72,
      isActive: true,
      expertCountries: { set: countryIds.map(id => ({ id })) },
    },
  });
}

async function ensureStudentPortrait(params: {
  user: Awaited<ReturnType<typeof upsertUser>>;
  currentStep: ProcessStep;
  subscription: SubscriptionTier;
  consultationBalance: number;
  consultantProfileId: number;
}) {
  const { user, currentStep, subscription, consultationBalance, consultantProfileId } = params;

  return prismaClient.studentPortrait.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      hasVisa: false,
      birthDate: new Date("2000-06-15T00:00:00.000Z"),
      educationLevel: EducationLevel.HIGH_SCHOOL,
      major: "Computer Science",
      gpa: 3.7,
      gpaScale: 4.0,
      budgetLimit: 15000,
      budgetCurrency: "USD",
      currentStep,
      overallProgress: 20,
      subscription,
      consultationBalance,
      isIdentityLocked: false,
      generationCount: 0,
      consultantProfileId,
    },
    update: {
      currentStep,
      subscription,
      consultationBalance,
      consultantProfileId,
    },
  });
}

async function ensureTargetProgram(params: {
  studentPortraitId: number;
  organisationId: number;
  programTitle: string;
  intake: string;
  deadline: Date | null;
  applicationStatus: ApplicationStatus;
  statusChangedAt: Date | null;
}) {
  const { studentPortraitId, organisationId, programTitle, intake, deadline, applicationStatus, statusChangedAt } = params;

  const existing = await prismaClient.targetProgram.findFirst({
    where: {
      studentPortraitId,
      organisationId,
      programTitle,
      intake,
    },
  });

  if (existing) {
    return prismaClient.targetProgram.update({
      where: { id: existing.id },
      data: {
        deadline: deadline ?? undefined,
        applicationStatus,
        statusChangedAt: statusChangedAt ?? undefined,
      },
    });
  }

  return prismaClient.targetProgram.create({
    data: {
      studentPortraitId,
      organisationId,
      programTitle,
      intake,
      deadline: deadline ?? undefined,
      applicationStatus,
      statusChangedAt: statusChangedAt ?? undefined,
    },
  });
}

async function ensureDocument(params: {
  studentPortraitId: number;
  title: string;
  documentType: RequirementType;
  fileUrl: string;
  status: DocumentStatus;
  targetProgramId?: number;
}) {
  const { studentPortraitId, title, documentType, fileUrl, status, targetProgramId } = params;

  const existing = await prismaClient.document.findFirst({
    where: { studentPortraitId, title, documentType },
  });

  if (existing) {
    return prismaClient.document.update({
      where: { id: existing.id },
      data: {
        fileUrl,
        status,
        targetProgramId: targetProgramId ?? undefined,
      },
    });
  }

  return prismaClient.document.create({
    data: {
      title,
      fileUrl,
      documentType,
      status,
      studentPortraitId,
      targetProgramId: targetProgramId ?? undefined,
    },
  });
}

async function ensureReview(params: { studentPortraitId: number; consultantProfileId: number; rating: number; comment?: string }) {
  const { studentPortraitId, consultantProfileId, rating, comment } = params;

  // Composite unique: Review(studentPortraitId, consultantProfileId)
  return prismaClient.review.upsert({
    where: {
      studentPortraitId_consultantProfileId: {
        studentPortraitId,
        consultantProfileId,
      },
    },
    create: { studentPortraitId, consultantProfileId, rating, comment },
    update: { rating, comment },
  });
}

export async function seedExpertMentorshipData() {
  const passwordHash = await bcrypt.hash("admin123", 10);

  const consultantProfile = await ensureConsultantProfile({ expertEmail: "expert@oxusedu.com" });
  const consultantProfileId = consultantProfile.id;

  // Ensure at least 3 student portraits assigned to the expert.
  // This covers different `currentStep` columns for the expert kanban.
  const studentSeeds = [
    {
      email: "student@oxusedu.com",
      phoneNumber: "+77010000003",
      firstname: "University",
      lastname: "Student",
      currentStep: ProcessStep.DISCOVERY,
      subscription: SubscriptionTier.EXPERT_MENTORSHIP,
      consultationBalance: 2,
      portraitOverallProgress: 15,
    },
    {
      email: "student2@oxusedu.com",
      phoneNumber: "+77010000005",
      firstname: "Alex",
      lastname: "Morgan",
      currentStep: ProcessStep.UNI_SELECTION,
      subscription: SubscriptionTier.EXPERT_MENTORSHIP,
      consultationBalance: 1,
      portraitOverallProgress: 45,
    },
    {
      email: "student3@oxusedu.com",
      phoneNumber: "+77010000006",
      firstname: "Sam",
      lastname: "Khan",
      currentStep: ProcessStep.DOC_PREPARATION,
      subscription: SubscriptionTier.ENTERPRISE,
      consultationBalance: 0,
      portraitOverallProgress: 70,
    },
    {
      email: "student4@oxusedu.com",
      phoneNumber: "+77010000007",
      firstname: "Taylor",
      lastname: "Reed",
      currentStep: ProcessStep.APPLYING,
      subscription: SubscriptionTier.EXPERT_MENTORSHIP,
      consultationBalance: 1,
      portraitOverallProgress: 85,
    },
    {
      email: "student5@oxusedu.com",
      phoneNumber: "+77010000008",
      firstname: "Jordan",
      lastname: "Kim",
      currentStep: ProcessStep.VISA_SUPPORT,
      subscription: SubscriptionTier.ENTERPRISE,
      consultationBalance: 0,
      portraitOverallProgress: 92,
    },
    {
      email: "student6@oxusedu.com",
      phoneNumber: "+77010000009",
      firstname: "Morgan",
      lastname: "Lee",
      currentStep: ProcessStep.ENROLLED,
      subscription: SubscriptionTier.ENTERPRISE,
      consultationBalance: 0,
      portraitOverallProgress: 100,
    },
  ] as const;

  const organisationSlugs: OrganisationSeed[] = [
    { slug: "mit", programTitle: "Computer Science", degreeLevel: "Bachelor", intake: "Fall 2026" },
    { slug: "oxford", programTitle: "Business Administration", degreeLevel: "Bachelor", intake: "Fall 2026" },
    { slug: "tum", programTitle: "Data Science", degreeLevel: "Master", intake: "Spring 2027" },
    { slug: "nu", programTitle: "Cybersecurity", degreeLevel: "Master", intake: "Spring 2027" },
  ];

  const now = new Date();
  const daysAgo = (days: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() - days);
    return d;
  };
  const daysFromNow = (days: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() + days);
    return d;
  };

  const orgBySlug = await Promise.all(
    organisationSlugs.map(async s => ({
      slug: s.slug,
      org: await prismaClient.organisation.findUnique({ where: { slug: s.slug } }),
    })),
  );

  const getOrgId = (slug: string) => {
    const found = orgBySlug.find(x => x.slug === slug)?.org;
    if (!found) throw new Error(`Organisation not found for slug=${slug}`);
    return found.id;
  };

  for (const s of studentSeeds) {
    const user = await upsertUser({
      email: s.email,
      phoneNumber: s.phoneNumber,
      firstname: s.firstname,
      lastname: s.lastname,
      roleId: 3, // STUDENT
      passwordHash,
    });

    await ensureStudentPackage({
      studentId: user.id,
      expertId: consultantProfileId,
      totalSlots: s.consultationBalance,
      usedSlots: 0,
    });

    const portrait = await ensureStudentPortrait({
      user,
      currentStep: s.currentStep,
      subscription: s.subscription,
      consultationBalance: s.consultationBalance,
      consultantProfileId,
    });

    // Update overallProgress so kanban ordering/visibility looks realistic.
    await prismaClient.studentPortrait.update({
      where: { id: portrait.id },
      data: { overallProgress: s.portraitOverallProgress },
    });

    // Create 2 target programs per portrait to populate kanban + stale detection.
    // Stale rules in `ExpertDashboardRepository.findStaleStudents`:
    // - applicationStatus must NOT be NOT_STARTED
    // - statusChangedAt must be < thresholdDate OR null

    if (s.email === "student@oxusedu.com") {
      const tp1OrgId = getOrgId("mit");
      const tp1 = await ensureTargetProgram({
        studentPortraitId: portrait.id,
        organisationId: tp1OrgId,
        programTitle: "Computer Science",
        intake: "Fall 2026",
        deadline: daysFromNow(7),
        applicationStatus: ApplicationStatus.IN_PROGRESS,
        statusChangedAt: daysAgo(20),
      });

      const tp2OrgId = getOrgId("oxford");
      const tp2 = await ensureTargetProgram({
        studentPortraitId: portrait.id,
        organisationId: tp2OrgId,
        programTitle: "Business Administration",
        intake: "Fall 2026",
        deadline: daysFromNow(30),
        applicationStatus: ApplicationStatus.SUBMITTED,
        statusChangedAt: daysAgo(2),
      });

      await ensureDocument({
        studentPortraitId: portrait.id,
        title: "SOP Draft",
        documentType: RequirementType.SOP,
        fileUrl: "https://example.com/seed/documents/sop-draft.pdf",
        status: DocumentStatus.DRAFT,
        targetProgramId: tp1.id,
      });

      await ensureDocument({
        studentPortraitId: portrait.id,
        title: "SOP Ready for Review",
        documentType: RequirementType.SOP,
        fileUrl: "https://example.com/seed/documents/sop-review.pdf",
        status: DocumentStatus.REVIEW,
        targetProgramId: tp1.id,
      });

      await ensureReview({
        studentPortraitId: portrait.id,
        consultantProfileId,
        rating: 5,
        comment: "Clear and actionable feedback on deadlines and documents.",
      });

      // Second document set for another target program.
      await ensureDocument({
        studentPortraitId: portrait.id,
        title: "CV Update v1",
        documentType: RequirementType.CV,
        fileUrl: "https://example.com/seed/documents/cv-v1.pdf",
        status: DocumentStatus.APPROVED,
        targetProgramId: tp2.id,
      });
    }

    if (s.email === "student2@oxusedu.com") {
      const tp1OrgId = getOrgId("tum");
      const tp1 = await ensureTargetProgram({
        studentPortraitId: portrait.id,
        organisationId: tp1OrgId,
        programTitle: "Data Science",
        intake: "Spring 2027",
        deadline: daysFromNow(15),
        applicationStatus: ApplicationStatus.INTERVIEW_STAGE,
        statusChangedAt: null, // stale by rule (null)
      });

      const tp2OrgId = getOrgId("nu");
      await ensureTargetProgram({
        studentPortraitId: portrait.id,
        organisationId: tp2OrgId,
        programTitle: "Cybersecurity",
        intake: "Spring 2027",
        deadline: daysFromNow(40),
        applicationStatus: ApplicationStatus.NOT_STARTED,
        statusChangedAt: null,
      });

      await ensureDocument({
        studentPortraitId: portrait.id,
        title: "Motivation Letter",
        documentType: RequirementType.SOP,
        fileUrl: "https://example.com/seed/documents/motivation-letter.pdf",
        status: DocumentStatus.NEEDS_REVISION,
        targetProgramId: tp1.id,
      });

      await ensureDocument({
        studentPortraitId: portrait.id,
        title: "CV for Interview",
        documentType: RequirementType.CV,
        fileUrl: "https://example.com/seed/documents/cv-interview.pdf",
        status: DocumentStatus.REVIEW,
        targetProgramId: tp1.id,
      });

      await ensureReview({
        studentPortraitId: portrait.id,
        consultantProfileId,
        rating: 4,
        comment: "Good focus on readiness and interview narrative.",
      });
    }

    if (s.email === "student3@oxusedu.com") {
      const tp1OrgId = getOrgId("mit");
      const tp1 = await ensureTargetProgram({
        studentPortraitId: portrait.id,
        organisationId: tp1OrgId,
        programTitle: "Computer Science",
        intake: "Fall 2026",
        deadline: daysFromNow(45),
        applicationStatus: ApplicationStatus.SUBMITTED,
        statusChangedAt: daysAgo(25),
      });

      const tp2OrgId = getOrgId("oxford");
      const tp2 = await ensureTargetProgram({
        studentPortraitId: portrait.id,
        organisationId: tp2OrgId,
        programTitle: "Business Administration",
        intake: "Fall 2026",
        deadline: daysFromNow(60),
        applicationStatus: ApplicationStatus.ACCEPTED,
        statusChangedAt: daysAgo(3),
      });

      await ensureDocument({
        studentPortraitId: portrait.id,
        title: "Passport Upload",
        documentType: RequirementType.PASSPORT,
        fileUrl: "https://example.com/seed/documents/passport.pdf",
        status: DocumentStatus.APPROVED,
        targetProgramId: tp1.id,
      });

      await ensureDocument({
        studentPortraitId: portrait.id,
        title: "Transcript v2",
        documentType: RequirementType.TRANSCRIPT,
        fileUrl: "https://example.com/seed/documents/transcript-v2.pdf",
        status: DocumentStatus.APPROVED,
        targetProgramId: tp2.id,
      });

      await ensureReview({
        studentPortraitId: portrait.id,
        consultantProfileId,
        rating: 5,
        comment: "Fast, professional review and excellent prioritization.",
      });
    }

    if (s.email === "student4@oxusedu.com") {
      const tp1OrgId = getOrgId("nu");
      const tp1 = await ensureTargetProgram({
        studentPortraitId: portrait.id,
        organisationId: tp1OrgId,
        programTitle: "Cybersecurity",
        intake: "Spring 2027",
        deadline: daysFromNow(20),
        applicationStatus: ApplicationStatus.SUBMITTED,
        statusChangedAt: daysAgo(8),
      });

      const tp2OrgId = getOrgId("tum");
      await ensureTargetProgram({
        studentPortraitId: portrait.id,
        organisationId: tp2OrgId,
        programTitle: "Data Science",
        intake: "Spring 2027",
        deadline: daysFromNow(10),
        applicationStatus: ApplicationStatus.IN_PROGRESS,
        statusChangedAt: null, // stale by rule (null)
      });

      await ensureDocument({
        studentPortraitId: portrait.id,
        title: "Application Form",
        documentType: RequirementType.SOP,
        fileUrl: "https://example.com/seed/documents/application-form.pdf",
        status: DocumentStatus.DRAFT,
        targetProgramId: tp1.id,
      });

      await ensureDocument({
        studentPortraitId: portrait.id,
        title: "Revised Motivation Letter",
        documentType: RequirementType.SOP,
        fileUrl: "https://example.com/seed/documents/motivation-letter-revised.pdf",
        status: DocumentStatus.REVIEW,
        targetProgramId: tp1.id,
      });

      await ensureReview({
        studentPortraitId: portrait.id,
        consultantProfileId,
        rating: 4,
        comment: "Solid execution phase; documents need small refinements.",
      });
    }

    if (s.email === "student5@oxusedu.com") {
      const tp1OrgId = getOrgId("oxford");
      const tp1 = await ensureTargetProgram({
        studentPortraitId: portrait.id,
        organisationId: tp1OrgId,
        programTitle: "Business Administration",
        intake: "Fall 2026",
        deadline: daysFromNow(5),
        applicationStatus: ApplicationStatus.ACCEPTED,
        statusChangedAt: daysAgo(1),
      });

      const tp2OrgId = getOrgId("mit");
      const tp2 = await ensureTargetProgram({
        studentPortraitId: portrait.id,
        organisationId: tp2OrgId,
        programTitle: "Computer Science",
        intake: "Fall 2026",
        deadline: daysFromNow(50),
        applicationStatus: ApplicationStatus.SUBMITTED,
        statusChangedAt: null, // stale by rule (null)
      });

      await ensureDocument({
        studentPortraitId: portrait.id,
        title: "VISA Support Checklist",
        documentType: RequirementType.TRANSCRIPT,
        fileUrl: "https://example.com/seed/documents/visa-checklist.pdf",
        status: DocumentStatus.NEEDS_REVISION,
        targetProgramId: tp1.id,
      });

      await ensureDocument({
        studentPortraitId: portrait.id,
        title: "Final Transcript",
        documentType: RequirementType.TRANSCRIPT,
        fileUrl: "https://example.com/seed/documents/final-transcript.pdf",
        status: DocumentStatus.APPROVED,
        targetProgramId: tp2.id,
      });

      await ensureReview({
        studentPortraitId: portrait.id,
        consultantProfileId,
        rating: 5,
        comment: "Great guidance on visa documentation and timelines.",
      });
    }

    if (s.email === "student6@oxusedu.com") {
      const tp1OrgId = getOrgId("mit");
      const tp1 = await ensureTargetProgram({
        studentPortraitId: portrait.id,
        organisationId: tp1OrgId,
        programTitle: "Computer Science",
        intake: "Fall 2026",
        deadline: daysFromNow(30),
        applicationStatus: ApplicationStatus.ACCEPTED,
        statusChangedAt: daysAgo(3),
      });

      await ensureDocument({
        studentPortraitId: portrait.id,
        title: "Enrollment Confirmation",
        documentType: RequirementType.PASSPORT,
        fileUrl: "https://example.com/seed/documents/enrollment-confirmation.pdf",
        status: DocumentStatus.APPROVED,
        targetProgramId: tp1.id,
      });

      await ensureReview({
        studentPortraitId: portrait.id,
        consultantProfileId,
        rating: 5,
        comment: "Everything completed smoothly; excellent mentor support.",
      });
    }
  }

  await seedExpertSchedule({ expertEmail: "expert@oxusedu.com" });

  const newExperts = [
    { firstname: "Mustafa", lastname: "Coskun", phone: "+4915771408357" },
    { firstname: "Durzhanbayev", lastname: "Muradil", phone: "+77077099509" },
    { firstname: "Smagulova", lastname: "Gulsana", phone: "+77004448363" },
  ];

  for (const expert of newExperts) {
    const emailLocal = `${expert.firstname.toLowerCase()}.${expert.lastname.toLowerCase()}`;
    const email = `${emailLocal}@oxusedu.com`;
    const hash = await bcrypt.hash(`${emailLocal}123`, 10);

    await upsertUser({
      email,
      phoneNumber: expert.phone,
      firstname: expert.firstname,
      lastname: expert.lastname,
      roleId: 2, // CONSULTANT / EXPERT
      passwordHash: hash,
    });

    await ensureConsultantProfile({ expertEmail: email });
  }

  console.log("✅ Expert mentorship seed data created (profile, assignments, kanban content).");
}

async function seedExpertSchedule(params: { expertEmail: string }) {
  const expert = await prismaClient.user.findUnique({ where: { email: params.expertEmail } });
  if (!expert) throw new Error(`Expert not found for email=${params.expertEmail}`);

  const MONDAY_TO_FRIDAY = [1, 2, 3, 4, 5];
  const TIME_SLOTS = [
    { startMinute: 4 * 60, endMinute: 6 * 60 }, // 09:00-11:00 KZ (04:00-06:00 UTC)
    { startMinute: 6 * 60, endMinute: 8 * 60 }, // 11:00-13:00 KZ (06:00-08:00 UTC)
    { startMinute: 9 * 60, endMinute: 11 * 60 }, // 14:00-16:00 KZ (09:00-11:00 UTC)
    { startMinute: 11 * 60, endMinute: 13 * 60 }, // 16:00-18:00 KZ (11:00-13:00 UTC)
    { startMinute: 16 * 60, endMinute: 19 * 60 }, // 21:00-14==24:00 KZ (16:00-19:00 UTC)
  ];

  for (const dayOfWeek of MONDAY_TO_FRIDAY) {
    for (const slot of TIME_SLOTS) {
      await prismaClient.expertSchedule.upsert({
        where: { expertId_dayOfWeek_startMinute: { expertId: expert.id, dayOfWeek, startMinute: slot.startMinute } },
        create: { expertId: expert.id, dayOfWeek, startMinute: slot.startMinute, endMinute: slot.endMinute },
        update: { endMinute: slot.endMinute },
      });
    }
  }
}

async function ensureStudentPackage(params: { studentId: number; expertId: number; totalSlots: number; usedSlots?: number }) {
  const { studentId, expertId, totalSlots, usedSlots = 0 } = params;

  return prismaClient.studentPackage.upsert({
    where: {
      studentId_expertId: {
        studentId,
        expertId,
      },
    },
    create: {
      studentId,
      expertId,
      totalSlots,
      usedSlots,
    },
    update: {
      totalSlots,
      usedSlots,
    },
  });
}
