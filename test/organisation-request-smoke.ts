import "dotenv/config";
import { PrismaService } from "src/database/prisma.service";
import { OrganisationRequestService } from "src/modules/organisation-request/service/organisation-request.service";
import { OrganisationRequestRepository } from "src/modules/organisation-request/repository/organisation-request.repository";

async function main() {
  const prisma = new PrismaService();
  await prisma.$connect();

  try {
    const admin = await prisma.user.findFirstOrThrow({
      where: { role: { code: "ADMIN" } },
      select: { id: true },
    });
    const expert = await prisma.user.findFirstOrThrow({
      where: { role: { code: "EXPERT" } },
      select: { id: true },
    });

    const repo = new OrganisationRequestRepository(prisma);
    const service = new OrganisationRequestService(repo);

    await prisma.organisationRequest.deleteMany({
      where: {
        universityName: "Imperial College London",
        requestedByUserId: expert.id,
      },
    });

    const created = await service.create(expert.id, {
      universityName: "Imperial College London",
      countryName: "United Kingdom",
      notes: "Need this university for a new expert shortlist.",
    });

    const approved = await service.approve(created.id, admin.id, {
      reviewNote: "Approved for QS import and program sync.",
    });

    const organisation = await prisma.organisation.findFirstOrThrow({
      where: { nameEn: "Imperial College London" },
      select: { id: true, nameEn: true, slug: true },
    });

    const resolved = await service.resolve(created.id, admin.id, {
      resolvedOrganisationId: organisation.id,
      reviewNote: "Resolved to imported organisation.",
    });

    console.log(
      JSON.stringify(
        {
          created,
          approved,
          resolved,
        },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
