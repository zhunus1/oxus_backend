import { Injectable, InternalServerErrorException, Logger, NotFoundException } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import * as XLSX from "xlsx";
import { QsImportJobStatus } from "generated/prisma/enums";
import { Prisma } from "generated/prisma/client";
import messages from "src/configs/messages";
import { CreateQsImportJobDto } from "../api/dto/create-qs-import-job.dto";
import { QueryQsImportJobDto } from "../api/dto/query-qs-import-job.dto";
import { QsImportRepository } from "../repository/qs-import.repository";

type QsWorksheetRow = Record<string, string | number | null>;

type ParsedQsRow = {
  rank: number | null;
  previousRank: number | null;
  name: string;
  countryName: string;
  region: string | null;
  size: string | null;
  focus: string | null;
  research: string | null;
  institutionStatus: string | null;
  overallScore: number | null;
};

type QsImportSummary = {
  rankingYear: number | null;
  totalRows: number;
  createdCount: number;
  updatedCount: number;
  skippedCount: number;
  failedCount: number;
  skippedRows: Array<{ rowNumber: number; universityName: string; reason: string }>;
  failedRows: Array<{ rowNumber: number; universityName: string; reason: string }>;
};

const QS_HEADER_ROW_KEYS = ["Index", "Rank", "Previous Rank", "Name", "Country/Territory"];

const COUNTRY_ALIASES: Record<string, string> = {
  "United States of America": "United States",
  "Republic of Korea": "South Korea",
  "Russian Federation": "Russia",
  Türkiye: "Turkey",
  "Hong Kong SAR": "Hong Kong",
  "Macao SAR": "Macao",
};

@Injectable()
export class QsImportService {
  private readonly logger = new Logger(QsImportService.name);
  private readonly entity = "QsOrganisationImportJob";

  constructor(
    private readonly repo: QsImportRepository,
    @InjectQueue("organisation-imports") private readonly organisationImportQueue: Queue,
  ) {}

  async createImportJob(file: Express.Multer.File, initiatedByUserId: number, dto: CreateQsImportJobDto) {
    if (!file?.buffer?.length) {
      throw new InternalServerErrorException("Uploaded QS file is empty.");
    }

    try {
      const rankingYear = this.extractRankingYear(file.originalname);
      const job = await this.repo.createJob({
        initiatedByUser: { connect: { id: initiatedByUserId } },
        status: QsImportJobStatus.QUEUED,
        fileName: file.originalname,
        rankingYear,
      });

      await this.organisationImportQueue.add(
        "run-qs-organisation-import",
        {
          importJobId: job.id,
          fileName: file.originalname,
          fileBufferBase64: file.buffer.toString("base64"),
          limit: dto.limit ?? null,
        },
        {
          jobId: `qs-organisation-import-${job.id}`,
          removeOnComplete: true,
          removeOnFail: false,
        },
      );

      return this.findJobById(job.id);
    } catch (err: any) {
      this.logger.error(messages.DATABASE_CREATE_ERROR(this.entity), err?.stack);
      throw new InternalServerErrorException(messages.DATABASE_CREATE_ERROR(this.entity));
    }
  }

  async listJobs(query: QueryQsImportJobDto) {
    return this.repo.findJobs(query);
  }

  async findJobById(id: number) {
    const job = await this.repo.findJobById(id);
    if (!job) {
      throw new NotFoundException(messages.NOT_FOUND_BY_ID(this.entity, id));
    }
    return job;
  }

  async processImportJob(importJobId: number, fileName: string, fileBufferBase64: string, limit: number | null) {
    const job = await this.repo.findJobById(importJobId);
    if (!job) {
      throw new NotFoundException(messages.NOT_FOUND_BY_ID(this.entity, importJobId));
    }

    await this.repo.updateJob(importJobId, {
      status: QsImportJobStatus.RUNNING,
      startedAt: new Date(),
      errorLog: null,
    });

    try {
      const summary = await this.importWorkbook(Buffer.from(fileBufferBase64, "base64"), fileName, limit);
      const hasErrors = summary.failedCount > 0 || summary.skippedCount > 0;

      await this.repo.updateJob(importJobId, {
        status: hasErrors ? QsImportJobStatus.COMPLETED_WITH_ERRORS : QsImportJobStatus.COMPLETED,
        rankingYear: summary.rankingYear,
        totalRows: summary.totalRows,
        createdCount: summary.createdCount,
        updatedCount: summary.updatedCount,
        skippedCount: summary.skippedCount,
        failedCount: summary.failedCount,
        rawSummary: summary,
        finishedAt: new Date(),
      });
    } catch (err: any) {
      this.logger.error(`Failed to process QS import job ${importJobId}`, err?.stack);
      await this.repo.updateJob(importJobId, {
        status: QsImportJobStatus.FAILED,
        errorLog: err instanceof Error ? err.message : messages.UNKNOWN_ERROR(),
        finishedAt: new Date(),
      });
    }
  }

  private async importWorkbook(fileBuffer: Buffer, fileName: string, limit: number | null): Promise<QsImportSummary> {
    const workbook = XLSX.read(fileBuffer, { type: "buffer" });
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) {
      throw new Error("QS workbook does not contain any sheets.");
    }

    const sheet = workbook.Sheets[firstSheetName];
    const rows = XLSX.utils.sheet_to_json<Array<string | number | null>>(sheet, {
      header: 1,
      blankrows: false,
      defval: null,
    });

    const headerRowIndex = rows.findIndex(row => QS_HEADER_ROW_KEYS.every((key, index) => row[index] === key));
    if (headerRowIndex === -1) {
      throw new Error("QS workbook header row was not found.");
    }

    const dataRows = XLSX.utils.sheet_to_json<QsWorksheetRow>(sheet, {
      range: headerRowIndex,
      defval: null,
    });

    const slicedRows = typeof limit === "number" ? dataRows.slice(0, limit) : dataRows;
    const countries = await this.repo.findCountries();
    const countryLookup = new Map(countries.filter(country => country.nameEn).map(country => [this.normalizeKey(country.nameEn!), country]));

    const summary: QsImportSummary = {
      rankingYear: this.extractRankingYear(fileName),
      totalRows: slicedRows.length,
      createdCount: 0,
      updatedCount: 0,
      skippedCount: 0,
      failedCount: 0,
      skippedRows: [],
      failedRows: [],
    };

    for (const [index, row] of slicedRows.entries()) {
      const rowNumber = headerRowIndex + 2 + index;
      const parsedRow = this.parseRow(row);

      if (!parsedRow) {
        summary.skippedCount += 1;
        summary.skippedRows.push({
          rowNumber,
          universityName: String(row["Name"] ?? ""),
          reason: "Row does not contain a valid university name and country.",
        });
        continue;
      }

      const country = this.findCountry(countryLookup, parsedRow.countryName);
      if (!country) {
        summary.skippedCount += 1;
        summary.skippedRows.push({
          rowNumber,
          universityName: parsedRow.name,
          reason: `Country '${parsedRow.countryName}' is not present in the Country table.`,
        });
        continue;
      }

      try {
        const slug = await this.buildUniqueSlug(parsedRow.name);
        const existingOrganisation = await this.repo.findOrganisationByNameAndCountry(parsedRow.name, country.id);

        const data: Prisma.OrganisationUpdateInput = {
          type: "UNIVERSITY",
          nameEn: parsedRow.name,
          country: { connect: { id: country.id } },
          qsRank: parsedRow.rank,
          qsPreviousRank: parsedRow.previousRank,
          qsRegion: parsedRow.region,
          qsSize: parsedRow.size,
          qsFocus: parsedRow.focus,
          qsResearch: parsedRow.research,
          qsInstitutionStatus: parsedRow.institutionStatus,
          qsOverallScore: parsedRow.overallScore,
          qsRankingYear: summary.rankingYear,
          qsImportedAt: new Date(),
        };

        if (existingOrganisation) {
          await this.repo.updateOrganisation(existingOrganisation.id, data);
          summary.updatedCount += 1;
          continue;
        }

        await this.repo.createOrganisation({
          slug,
          type: "UNIVERSITY",
          nameEn: parsedRow.name,
          country: { connect: { id: country.id } },
          qsRank: parsedRow.rank,
          qsPreviousRank: parsedRow.previousRank,
          qsRegion: parsedRow.region,
          qsSize: parsedRow.size,
          qsFocus: parsedRow.focus,
          qsResearch: parsedRow.research,
          qsInstitutionStatus: parsedRow.institutionStatus,
          qsOverallScore: parsedRow.overallScore,
          qsRankingYear: summary.rankingYear,
          qsImportedAt: new Date(),
        });
        summary.createdCount += 1;
      } catch (err: any) {
        summary.failedCount += 1;
        summary.failedRows.push({
          rowNumber,
          universityName: parsedRow.name,
          reason: err instanceof Error ? err.message : messages.UNKNOWN_ERROR(),
        });
      }
    }

    return summary;
  }

  private parseRow(row: QsWorksheetRow): ParsedQsRow | null {
    const name = this.asTrimmedString(row["Name"]);
    const countryName = this.asTrimmedString(row["Country/Territory"]);

    if (!name || !countryName || name === "Institution") {
      return null;
    }

    return {
      rank: this.parseNumericCell(row["Rank"]),
      previousRank: this.parseNumericCell(row["Previous Rank"]),
      name,
      countryName,
      region: this.asNullableString(row["Region"]),
      size: this.asNullableString(row["Size"]),
      focus: this.asNullableString(row["Focus"]),
      research: this.asNullableString(row["Research"]),
      institutionStatus: this.asNullableString(row["Status"]),
      overallScore: this.parseNumericCell(row["Overall SCORE"]),
    };
  }

  private findCountry(countryLookup: Map<string, { id: number; isoCode: string; nameEn: string | null }>, countryName: string) {
    const normalizedName = this.normalizeKey(COUNTRY_ALIASES[countryName] ?? countryName);
    return countryLookup.get(normalizedName) ?? null;
  }

  private async buildUniqueSlug(name: string): Promise<string> {
    const baseSlug = this.slugify(name);
    let candidate = baseSlug;
    let suffix = 1;

    while (await this.repo.findOrganisationBySlug(candidate)) {
      candidate = `${baseSlug}-${suffix}`;
      suffix += 1;
    }

    return candidate;
  }

  private slugify(value: string) {
    return value
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/[\s_]+/g, "-")
      .replace(/-+/g, "-");
  }

  private extractRankingYear(fileName: string) {
    const match = fileName.match(/(20\d{2})/);
    return match ? Number(match[1]) : null;
  }

  private parseNumericCell(value: string | number | null) {
    if (value === null || value === "") return null;
    if (typeof value === "number") return value;

    const normalized = String(value).trim();
    if (!normalized || normalized === "-" || normalized.toUpperCase() === "N/A") return null;
    if (normalized.includes("=")) return null;

    const parsed = Number(normalized.replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }

  private asTrimmedString(value: string | number | null) {
    if (value === null || value === undefined) return "";
    return String(value).trim();
  }

  private asNullableString(value: string | number | null) {
    const text = this.asTrimmedString(value);
    return text || null;
  }

  private normalizeKey(value: string) {
    return value.trim().toLowerCase();
  }
}
