import "dotenv/config";
import { readFile } from "node:fs/promises";
import { PrismaService } from "src/database/prisma.service";
import { QsImportRepository } from "src/modules/qs-import/repository/qs-import.repository";
import { QsImportService } from "src/modules/qs-import/service/qs-import.service";

const QS_FILE_PATH = "/Users/nurgissa/Downloads/2026_qs_world_university_rankings_10_for_qscom_1.31e9b196360f.xlsx";

async function main() {
  const prisma = new PrismaService();
  await prisma.$connect();

  try {
    const repo = new QsImportRepository(prisma);
    const queueCalls: any[] = [];
    const queueStub = {
      add: async (_name: string, payload: any) => {
        queueCalls.push(payload);
        return null;
      },
    } as any;

    const service = new QsImportService(repo, queueStub);
    const buffer = await readFile(QS_FILE_PATH);

    const createdJob = await service.createImportJob(
      {
        originalname: "2026_qs_world_university_rankings.xlsx",
        buffer,
      } as Express.Multer.File,
      1,
      { limit: 10 },
    );

    const payload = queueCalls[0];
    await service.processImportJob(payload.importJobId, payload.fileName, payload.fileBufferBase64, payload.limit);

    const finalJob = await service.findJobById(createdJob.id);
    const organisations = await prisma.organisation.findMany({
      where: {
        qsRankingYear: 2026,
        qsRank: {
          lte: 10,
        },
      },
      orderBy: {
        qsRank: "asc",
      },
      select: {
        id: true,
        nameEn: true,
        slug: true,
        qsRank: true,
        qsPreviousRank: true,
        qsOverallScore: true,
        country: {
          select: {
            nameEn: true,
            isoCode: true,
          },
        },
      },
      take: 12,
    });

    console.log(
      JSON.stringify(
        {
          workflow: [
            "1. Admin uploads the QS XLSX through POST /admin/qs-import-jobs.",
            "2. Backend creates a QUEUED QsOrganisationImportJob.",
            "3. Worker parses the rankings workbook and maps countries to Country rows.",
            "4. Backend creates or updates Organisation rows with QS metadata.",
            "5. Admin can inspect createdCount, updatedCount, skippedCount, and failedCount on the job.",
          ],
          createdJob: {
            id: createdJob.id,
            status: createdJob.status,
            rankingYear: createdJob.rankingYear,
            fileName: createdJob.fileName,
          },
          finalJob: {
            id: finalJob.id,
            status: finalJob.status,
            rankingYear: finalJob.rankingYear,
            totalRows: finalJob.totalRows,
            createdCount: finalJob.createdCount,
            updatedCount: finalJob.updatedCount,
            skippedCount: finalJob.skippedCount,
            failedCount: finalJob.failedCount,
          },
          organisations,
          rawSummaryPreview: finalJob.rawSummary,
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
