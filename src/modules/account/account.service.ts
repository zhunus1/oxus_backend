import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { PrismaService } from "src/database/prisma.service";
import { UserEntity } from "src/modules/admin/users/api/dto/user.entity";
import * as bcrypt from "bcrypt";
import { UpdateAccountProfileDto } from "./api/dto/update-account-profile.dto";
import { ChangeAccountPasswordDto } from "./api/dto/change-account-password.dto";

@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);

  constructor(private readonly prisma: PrismaService) {}

  async updateProfile(userId: number, dto: UpdateAccountProfileDto): Promise<UserEntity> {
    const existing = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!existing || existing.deletedAt != null) {
      throw new NotFoundException("User not found");
    }

    if (dto.email !== undefined && dto.email !== existing.email) {
      const clash = await this.prisma.user.findFirst({
        where: { email: dto.email, id: { not: userId } },
        select: { id: true },
      });
      if (clash) {
        throw new BadRequestException("Email is already in use");
      }
    }

    if (dto.phoneNumber !== undefined && dto.phoneNumber !== existing.phoneNumber) {
      const clash = await this.prisma.user.findFirst({
        where: { phoneNumber: dto.phoneNumber, id: { not: userId } },
        select: { id: true },
      });
      if (clash) {
        throw new BadRequestException("Phone number is already in use");
      }
    }

    if (dto.countryId !== undefined && dto.countryId !== null) {
      const c = await this.prisma.country.findUnique({ where: { id: dto.countryId } });
      if (!c) {
        throw new BadRequestException("Invalid country of residence");
      }
    }
    if (dto.citizenshipCountryId !== undefined && dto.citizenshipCountryId !== null) {
      const c = await this.prisma.country.findUnique({ where: { id: dto.citizenshipCountryId } });
      if (!c) {
        throw new BadRequestException("Invalid citizenship country");
      }
    }

    try {
      const user = await this.prisma.user.update({
        where: { id: userId },
        data: {
          ...(dto.firstname !== undefined ? { firstname: dto.firstname } : {}),
          ...(dto.lastname !== undefined ? { lastname: dto.lastname } : {}),
          ...(dto.middlename !== undefined ? { middlename: dto.middlename?.trim() || null } : {}),
          ...(dto.email !== undefined ? { email: dto.email } : {}),
          ...(dto.phoneNumber !== undefined ? { phoneNumber: dto.phoneNumber } : {}),
          ...(dto.countryId !== undefined ? { countryId: dto.countryId } : {}),
          ...(dto.citizenshipCountryId !== undefined ? { citizenshipCountryId: dto.citizenshipCountryId } : {}),
        },
        omit: { password: true },
        include: { role: { select: { id: true, code: true } } },
      });
      return new UserEntity(user);
    } catch (err: any) {
      this.logger.error(`updateProfile failed for user ${userId}: ${err}`);
      throw err;
    }
  }

  async changePassword(userId: number, dto: ChangeAccountPasswordDto): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, password: true, deletedAt: true },
    });
    if (!user || user.deletedAt != null) {
      throw new NotFoundException("User not found");
    }

    const matches = await bcrypt.compare(dto.currentPassword, user.password);
    if (!matches) {
      throw new BadRequestException("Current password is incorrect");
    }
    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException("New password must be different from the current password");
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { password: await bcrypt.hash(dto.newPassword, 10) },
    });
  }
}
