import { Injectable, InternalServerErrorException, Logger, NotFoundException } from "@nestjs/common";
import messages from "../../../../configs/messages";
import { PermissionRepository } from "../repository/permission.repository";
import { PermissionModel } from "../repository/permission.model";

@Injectable()
export class PermissionService {
  private readonly logger = new Logger(PermissionService.name);
  private readonly entity = "Permission";

  constructor(private readonly repo: PermissionRepository) {}

  async findAll(): Promise<PermissionModel[]> {
    try {
      return await this.repo.findAll();
    } catch (err: any) {
      this.logger.error(messages.DATABASE_FETCH_ERROR(this.entity), err?.stack);
      throw new InternalServerErrorException(messages.DATABASE_FETCH_ERROR(this.entity));
    }
  }

  async findOne(id: number): Promise<PermissionModel> {
    try {
      const perm = await this.repo.findOne(id);
      if (!perm) throw new NotFoundException(messages.NOT_FOUND_BY_ID(this.entity, id));
      return perm;
    } catch (err: any) {
      if (err instanceof NotFoundException) throw err;
      this.logger.error(messages.DATABASE_FETCH_ERROR_BY_ID(this.entity, id), err?.stack);
      throw new InternalServerErrorException(messages.DATABASE_FETCH_ERROR_BY_ID(this.entity, id));
    }
  }
}
