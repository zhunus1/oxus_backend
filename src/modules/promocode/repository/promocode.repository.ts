import { PrismaService } from "src/database/prisma.service";
import { CreatePromocodeDto } from "../api/dto/create-promocode.dto";
import { Prisma, PromoCode } from "generated/prisma/client";
import { UpdatePromocodeDto } from "../api/dto/update-promocode.dto";
import { QueryPromocodeDto } from "../api/dto/query-promocode.dto";
import { Injectable } from "@nestjs/common";

@Injectable()
export class PromocodeRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(createPromocodeDto: CreatePromocodeDto): Promise<PromoCode> {
    const { code, discountPct, discountAbs, maxUses, expiresAt, isActive } = createPromocodeDto;
    return this.prisma.promoCode.create({
      data: {
        code,
        discountPct,
        discountAbs,
        maxUses,
        expiresAt: expiresAt ? new Date(expiresAt) : undefined,
        isActive: isActive ?? undefined,
      },
    });
  }

  async updateById(id: number, updatePromocodeDto: UpdatePromocodeDto): Promise<PromoCode> {
    const updateData: Prisma.PromoCodeUpdateInput = {};
    if (updatePromocodeDto.code !== undefined) updateData.code = updatePromocodeDto.code;
    if (updatePromocodeDto.discountAbs !== undefined) updateData.discountAbs = updatePromocodeDto.discountAbs;
    if (updatePromocodeDto.discountPct !== undefined) updateData.discountPct = updatePromocodeDto.discountPct;
    if (updatePromocodeDto.maxUses !== undefined) updateData.maxUses = updatePromocodeDto.maxUses;
    if (updatePromocodeDto.expiresAt !== undefined) updateData.expiresAt = new Date(updatePromocodeDto.expiresAt);
    if (updatePromocodeDto.isActive !== undefined) updateData.isActive = updatePromocodeDto.isActive;

    return this.prisma.promoCode.update({
      where: { id },
      data: updateData,
    });
  }

  async findById(id: number): Promise<PromoCode | null> {
    return this.prisma.promoCode.findUnique({ where: { id } });
  }

  async findByCode(code: string): Promise<PromoCode | null> {
    return this.prisma.promoCode.findUnique({ where: { code } });
  }

  async findAll(queryPromocodeDto: QueryPromocodeDto): Promise<PromoCode[]> {
    const { search, isActive, expiresFrom, expiresTo, take, skip } = queryPromocodeDto;
    const where: Prisma.PromoCodeWhereInput = {};

    if (search) {
      where.code = { contains: search, mode: "insensitive" };
    }

    if (expiresFrom || expiresTo) {
      where.expiresAt = {};
      if (expiresFrom) where.expiresAt.gte = new Date(expiresFrom);
      if (expiresTo) where.expiresAt.lte = new Date(expiresTo);
    }
    if (isActive !== undefined) where.isActive = isActive;

    return this.prisma.promoCode.findMany({
      where,
      skip,
      take,
      orderBy: { expiresAt: "desc" },
    });
  }
}
