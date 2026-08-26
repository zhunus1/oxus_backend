import { BadRequestException, Injectable, InternalServerErrorException, Logger, NotFoundException } from "@nestjs/common";
import { Prisma, Organisation } from "generated/prisma/client";
import { CreateOrganisationDto } from "../api/dto/create-organisation.dto";
import { UpdateOrganisationDto } from "../api/dto/update-organisation.dto";
import messages from "src/configs/messages";
import { OrganisationRepository } from "../repository/organisation.repository";
import { QueryOrganisationDto } from "../api/dto/query-organisation.dto";
import { UploadService } from "src/common/utils/minio/upload.service";

const ALLOWED_LOGO_MIME = ["image/jpeg", "image/png", "image/webp"];
const MAX_LOGO_BYTES = 512 * 1024;

@Injectable()
export class OrganisationService {
  private readonly logger = new Logger(OrganisationService.name);
  private readonly entity = "Organisation";

  constructor(
    private readonly repo: OrganisationRepository,
    private readonly uploadService: UploadService,
  ) {}

  async create(dto: CreateOrganisationDto): Promise<Organisation> {
    try {
      const data: Prisma.OrganisationCreateInput = {
        nameKk: dto.nameKk,
        nameRu: dto.nameRu,
        nameEn: dto.nameEn,
        slug: dto.slug,
        type: dto.type,
        websiteUrl: dto.websiteUrl,
        country: { connect: { id: dto.countryId } },
      };
      return await this.repo.create(data);
    } catch (err: any) {
      this.logger.error(messages.DATABASE_CREATE_ERROR(this.entity), err?.stack);
      throw new InternalServerErrorException(messages.DATABASE_CREATE_ERROR(this.entity));
    }
  }

  async findAll(dto: QueryOrganisationDto): Promise<Organisation[]> {
    try {
      const where: Prisma.OrganisationWhereInput = {};

      if (dto.type) where.type = dto.type;
      if (dto.query) {
        where.OR = [
          { nameKk: { contains: dto.query, mode: "insensitive" } },
          { nameRu: { contains: dto.query, mode: "insensitive" } },
          { nameEn: { contains: dto.query, mode: "insensitive" } },
          { slug: { contains: dto.query, mode: "insensitive" } },
        ];
      }
      if (dto.country) {
        where.country = {
          OR: [
            { nameEn: { contains: dto.country, mode: "insensitive" } },
            { nameRu: { contains: dto.country, mode: "insensitive" } },
            { isoCode: { contains: dto.country, mode: "insensitive" } },
          ],
        };
      }

      const degreeLevels = dto.degreeLevel ? dto.degreeLevel.split(",").filter(Boolean) : [];
      const hasProgramFilter = degreeLevels.length > 0 || dto.tuitionMax != null || dto.gpaMax != null || dto.ieltsMax != null;
      if (hasProgramFilter) {
        const programWhere: any = {};
        if (degreeLevels.length > 0) programWhere.degreeLevel = { in: degreeLevels };
        if (dto.tuitionMax != null) programWhere.tuitionFee = { lte: dto.tuitionMax };
        if (dto.gpaMax != null) programWhere.minGPA = { lte: dto.gpaMax };
        if (dto.ieltsMax != null) programWhere.minIELTS = { lte: dto.ieltsMax };
        where.programs = { some: programWhere };
      }

      return await this.repo.findAll({ where, skip: dto.skip, take: dto.take });
    } catch (err: any) {
      this.logger.error(messages.DATABASE_FETCH_ERROR(this.entity), err?.stack);
      throw new InternalServerErrorException(messages.DATABASE_FETCH_ERROR(this.entity));
    }
  }

  async findById(id: number): Promise<Organisation> {
    try {
      const row = await this.repo.findById(id);
      if (!row) throw new NotFoundException(messages.NOT_FOUND_BY_ID(this.entity, id));
      return row;
    } catch (err: any) {
      if (err instanceof NotFoundException) throw err;
      this.logger.error(messages.DATABASE_FETCH_ERROR_BY_ID(this.entity, id), err?.stack);
      throw new InternalServerErrorException(messages.DATABASE_FETCH_ERROR_BY_ID(this.entity, id));
    }
  }

  async findBySlug(slug: string): Promise<Organisation> {
    try {
      const row = await this.repo.findBySlug(slug);
      if (!row) throw new NotFoundException(messages.NOT_FOUND_ALMOST_ONE(this.entity));
      return row;
    } catch (err: any) {
      if (err instanceof NotFoundException) throw err;
      this.logger.error(messages.DATABASE_FETCH_ERROR(this.entity), err?.stack);
      throw new InternalServerErrorException(messages.DATABASE_FETCH_ERROR(this.entity));
    }
  }

  async updateById(id: number, dto: UpdateOrganisationDto): Promise<Organisation> {
    try {
      await this.findById(id);
      const data: Prisma.OrganisationUpdateInput = {};

      if (dto.nameKk !== undefined) data.nameKk = dto.nameKk;
      if (dto.nameRu !== undefined) data.nameRu = dto.nameRu;
      if (dto.nameEn !== undefined) data.nameEn = dto.nameEn;
      if (dto.slug !== undefined) data.slug = dto.slug;
      if (dto.type !== undefined) data.type = dto.type;
      if (dto.websiteUrl !== undefined) data.websiteUrl = dto.websiteUrl;
      if (dto.countryId !== undefined) data.country = { connect: { id: dto.countryId } };

      return await this.repo.updateById(id, data);
    } catch (err: any) {
      if (err instanceof NotFoundException || err instanceof BadRequestException) throw err;
      this.logger.error(messages.DATABASE_UPDATE_ERROR(this.entity, id), err?.stack);
      throw new InternalServerErrorException(messages.DATABASE_UPDATE_ERROR(this.entity, id));
    }
  }

  async deleteById(id: number) {
    try {
      return await this.repo.deleteById(id);
    } catch (err: any) {
      this.logger.error(messages.DATABASE_DELETE_ERROR(this.entity, id), err?.stack);
      throw new InternalServerErrorException(messages.DATABASE_DELETE_ERROR(this.entity, id));
    }
  }

  async getStats() {
    try {
      const raw = await this.repo.getStats(14);
      return {
        totalCount: raw.totalCount,
        avgProgramsPerOrg: raw.totalCount > 0 ? Math.round((raw.totalPrograms / raw.totalCount) * 10) / 10 : 0,
        byCountry: raw.byCountry,
        completeness: raw.completeness,
      };
    } catch (err: any) {
      this.logger.error("Failed to compute organisation stats", err?.stack);
      throw new InternalServerErrorException("Failed to compute organisation stats");
    }
  }

  async uploadLogo(id: number, file: Express.Multer.File): Promise<Organisation> {
    try {
      if (!file) throw new BadRequestException("No file provided");
      if (!ALLOWED_LOGO_MIME.includes(file.mimetype)) {
        throw new BadRequestException("Logo must be a JPEG, PNG, or WebP image");
      }
      if (file.size > MAX_LOGO_BYTES) {
        throw new BadRequestException("Logo must be 512 KB or smaller");
      }
      await this.findById(id);
      const imageUrl = await this.uploadService.uploadFile("organisations", file);
      const data: Prisma.OrganisationUpdateInput = { image: imageUrl };
      return await this.repo.updateById(id, data);
    } catch (err: any) {
      if (err instanceof NotFoundException || err instanceof BadRequestException) throw err;
      this.logger.error(messages.DATABASE_UPDATE_ERROR(this.entity, id), err?.stack);
      throw new InternalServerErrorException(messages.DATABASE_UPDATE_ERROR(this.entity, id));
    }
  }

  async clearLogo(id: number): Promise<Organisation> {
    try {
      await this.findById(id);
      const data: Prisma.OrganisationUpdateInput = { image: null };
      return await this.repo.updateById(id, data);
    } catch (err: any) {
      if (err instanceof NotFoundException) throw err;
      this.logger.error(messages.DATABASE_UPDATE_ERROR(this.entity, id), err?.stack);
      throw new InternalServerErrorException(messages.DATABASE_UPDATE_ERROR(this.entity, id));
    }
  }

  async uploadCover(id: number, file: Express.Multer.File): Promise<Organisation> {
    try {
      if (!file) throw new BadRequestException("No file provided");
      if (!ALLOWED_LOGO_MIME.includes(file.mimetype)) {
        throw new BadRequestException("Cover must be a JPEG, PNG, or WebP image");
      }
      if (file.size > 2 * 1024 * 1024) {
        throw new BadRequestException("Cover must be 2 MB or smaller");
      }
      await this.findById(id);
      const imageUrl = await this.uploadService.uploadFile("organisations/covers", file);
      const data: Prisma.OrganisationUpdateInput = { coverImage: imageUrl };
      return await this.repo.updateById(id, data);
    } catch (err: any) {
      if (err instanceof NotFoundException || err instanceof BadRequestException) throw err;
      this.logger.error(messages.DATABASE_UPDATE_ERROR(this.entity, id), err?.stack);
      throw new InternalServerErrorException(messages.DATABASE_UPDATE_ERROR(this.entity, id));
    }
  }

  async clearCover(id: number): Promise<Organisation> {
    try {
      await this.findById(id);
      const data: Prisma.OrganisationUpdateInput = { coverImage: null };
      return await this.repo.updateById(id, data);
    } catch (err: any) {
      if (err instanceof NotFoundException) throw err;
      this.logger.error(messages.DATABASE_UPDATE_ERROR(this.entity, id), err?.stack);
      throw new InternalServerErrorException(messages.DATABASE_UPDATE_ERROR(this.entity, id));
    }
  }

  async deleteMany(ids: number[]) {
    try {
      return await this.repo.deleteMany(ids);
    } catch (err: any) {
      this.logger.error(messages.DATABASE_DELETE_ERROR_ARRAY(this.entity, ids), err?.stack);
      throw new InternalServerErrorException(messages.DATABASE_DELETE_ERROR_ARRAY(this.entity, ids));
    }
  }
}
