import "dotenv/config";
import { PrismaService } from "src/database/prisma.service";
import { OrganisationImportRepository } from "src/modules/organisation-import/repository/organisation-import.repository";
import { OrganisationImportService } from "src/modules/organisation-import/service/organisation-import.service";
import { ProgramCatalogAgentService } from "src/modules/organisation-import/service/program-catalog-agent.service";

const TEST_ORG = {
  slug: "imperial-college-london-smoke",
  nameEn: "Imperial College London",
  nameRu: "Imperial College London",
  nameKk: "Imperial College London",
  countryId: 4,
};

async function main() {
  const prisma = new PrismaService();
  await prisma.$connect();

  try {
    await prisma.program.deleteMany({
      where: {
        organisation: {
          slug: TEST_ORG.slug,
        },
      },
    });

    await prisma.organisationImportSnapshot.deleteMany({
      where: {
        importJob: {
          organisation: {
            slug: TEST_ORG.slug,
          },
        },
      },
    });

    await prisma.organisationImportJob.deleteMany({
      where: {
        organisation: {
          slug: TEST_ORG.slug,
        },
      },
    });

    await prisma.organisation.deleteMany({
      where: { slug: TEST_ORG.slug },
    });

    const organisation = await prisma.organisation.create({
      data: {
        slug: TEST_ORG.slug,
        nameEn: TEST_ORG.nameEn,
        nameRu: TEST_ORG.nameRu,
        nameKk: TEST_ORG.nameKk,
        countryId: TEST_ORG.countryId,
      },
    });

    const repo = new OrganisationImportRepository(prisma);
    const agent = new ProgramCatalogAgentService();
    const queueStub = {
      add: async () => null,
    } as any;

    const service = new OrganisationImportService(repo, agent, queueStub);

    const createdJob = await service.createProgramSyncJob(organisation.id, 1, {
      searchQuery: "Imperial College London official undergraduate postgraduate programs admissions",
    });

    await service.processProgramSyncJob(createdJob.id);

    const finalJob = await service.findProgramSyncJobById(createdJob.id);
    const importedPrograms = await prisma.program.findMany({
      where: { organisationId: organisation.id },
      orderBy: [{ degreeLevel: "asc" }, { name: "asc" }],
      take: 12,
      select: {
        id: true,
        name: true,
        degreeLevel: true,
        tuitionFee: true,
        minGPA: true,
        minIELTS: true,
        baseAcceptanceRate: true,
        applicationDeadline: true,
      },
    });

    console.log(
      JSON.stringify(
        {
          workflow: [
            "1. Admin has an Organisation row in the database.",
            "2. Admin creates POST /admin/organisations/:id/program-sync-jobs.",
            "3. Backend creates a QUEUED job.",
            "4. Worker uses AI + official web search to discover the university website and programs.",
            "5. Backend upserts Program rows for that organisation.",
            "6. Job stores consulted URLs and raw extracted result.",
          ],
          organisation: {
            id: organisation.id,
            slug: organisation.slug,
            nameEn: organisation.nameEn,
          },
          createdJob: {
            id: createdJob.id,
            status: createdJob.status,
            searchQuery: createdJob.searchQuery,
          },
          finalJob: {
            id: finalJob.id,
            status: finalJob.status,
            searchQuery: finalJob.searchQuery,
            officialWebsiteUrl: finalJob.officialWebsiteUrl,
            importedProgramCount: finalJob.importedProgramCount,
            createdProgramCount: finalJob.createdProgramCount,
            updatedProgramCount: finalJob.updatedProgramCount,
            errorLog: finalJob.errorLog,
            consultedUrls: Array.isArray(finalJob.rawResult) ? finalJob.rawResult : ((finalJob.rawResult as any)?.consultedUrls ?? []),
          },
          snapshots: finalJob.snapshots.map(snapshot => ({
            id: snapshot.id,
            sourceUrl: snapshot.sourceUrl,
            pageTitle: snapshot.pageTitle,
            extractedDataPreview: snapshot.extractedData,
          })),
          importedPrograms,
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
