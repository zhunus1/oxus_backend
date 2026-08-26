import { Injectable, InternalServerErrorException, NotFoundException, Logger, ConflictException } from "@nestjs/common";
import messages from "../../../../configs/messages";
import { RoleRepository } from "../repository/role.repository";
import { RoleModel } from "../repository/role.model";
import { CreateRoleDto } from "../api/dtos/create-role.dto";
import { UpdateRoleDto } from "../api/dtos/update-role.dto";
import { Prisma } from "generated/prisma/client";

@Injectable()
export class RoleService {
  private readonly entity = "Role";
  private readonly logger = new Logger(RoleService.name);

  constructor(private readonly repo: RoleRepository) {}

  async create(dto: CreateRoleDto): Promise<RoleModel> {
    try {
      return await this.repo.create({
        name: dto.name,
        code: dto.code || dto.name,
        description: dto.description ?? null,
        permissionIds: dto.permissions,
      });
    } catch (err: any) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new ConflictException(messages.ALREADY_USED("Code"));
      }
      this.logger.error(messages.DATABASE_CREATE_ERROR(this.entity), err?.stack);
      throw new InternalServerErrorException(messages.DATABASE_CREATE_ERROR(this.entity));
    }
  }

  async findAll(): Promise<RoleModel[]> {
    try {
      return await this.repo.findAll();
    } catch (err: any) {
      this.logger.error(messages.DATABASE_FETCH_ERROR(this.entity), err?.stack);
      throw new InternalServerErrorException(messages.DATABASE_FETCH_ERROR(this.entity));
    }
  }

  async findOne(id: number): Promise<RoleModel> {
    try {
      const role = await this.repo.findOne(id);
      if (!role) throw new NotFoundException(messages.NOT_FOUND_BY_ID(this.entity, id));
      return role;
    } catch (err: any) {
      if (err instanceof NotFoundException) throw err;
      this.logger.error(messages.DATABASE_FETCH_ERROR_BY_ID(this.entity, id), err?.stack);
      throw new InternalServerErrorException(messages.DATABASE_FETCH_ERROR_BY_ID(this.entity, id));
    }
  }

  async update(id: number, dto: UpdateRoleDto): Promise<RoleModel> {
    try {
      await this.findOne(id);
      return await this.repo.update(id, {
        name: dto.name,
        code: dto.code,
        description: dto.description ?? null,
        permissionIds: dto.permissions,
      });
    } catch (err: any) {
      if (err instanceof NotFoundException) throw err;
      this.logger.error(messages.DATABASE_UPDATE_ERROR(this.entity, id), err?.stack);
      throw new InternalServerErrorException(messages.DATABASE_UPDATE_ERROR(this.entity, id));
    }
  }
}
