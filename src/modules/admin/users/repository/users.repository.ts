import { Injectable } from "@nestjs/common";
import { PrismaService } from "src/database/prisma.service";
import { User } from "generated/prisma/client";
import { CreateUserDto } from "../api/dto/create-user.dto";
import { UpdateUserDto } from "../api/dto/update-user.dto";
import { UsersQueryDto } from "../api/dto/users-query.dto";
import { Prisma } from "generated/prisma/client";

@Injectable()
export class UsersRepository {
  constructor(private prisma: PrismaService) {}

  async create(data: CreateUserDto): Promise<User> {
    return this.prisma.user.create({
      data: {
        firstname: data.firstname,
        lastname: data.lastname,
        email: data.email,
        phoneNumber: data.phoneNumber,
        organisationId: data.organisationId,
        password: data.password,
        countryId: data.countryId,
        roleId: data.roleId,
        citizenshipCountryId: data.citizenshipCountryId,
      },
    });
  }

  async update(id: number, data: UpdateUserDto): Promise<User> {
    return this.prisma.user.update({
      data: {
        firstname: data.firstname,
        lastname: data.lastname,
        email: data.email,
        organisationId: data.organisationId,
        password: data.password,
      },
      where: { id: id },
    });
  }

  async findMany(query: UsersQueryDto) {
    const { roleId, roleCode, countryId, citizenshipCountryId, organisationId, search, skip, take } = query;

    const where: Prisma.UserWhereInput = {
      deletedAt: null,
    };

    if (roleCode) {
      where.role = { code: roleCode };
    } else if (roleId) {
      where.roleId = roleId;
    }
    if (countryId) where.countryId = countryId;
    if (citizenshipCountryId) where.citizenshipCountryId = citizenshipCountryId;
    if (organisationId) where.organisationId = organisationId;

    if (search) {
      where.OR = [
        { firstname: { contains: search, mode: "insensitive" } },
        { lastname: { contains: search, mode: "insensitive" } },
        { email: { contains: search, mode: "insensitive" } },
        { phoneNumber: { contains: search, mode: "insensitive" } },
      ];
    }

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take,
        select: {
          id: true,
          firstname: true,
          lastname: true,
          email: true,
          phoneNumber: true,
          roleId: true,
          createdAt: true,
          deletedAt: true,
          role: {
            select: { id: true, code: true, name: true },
          },
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    return { users, total };
  }

  async findOne(email: string): Promise<(User & { role: { id: number; code: string } }) | null> {
    return this.prisma.user.findUnique({ where: { email: email }, include: { role: { select: { id: true, code: true } } } });
  }

  async findByEmailInsensitive(email: string) {
    return this.prisma.user.findFirst({
      where: { email: { equals: email.trim(), mode: "insensitive" } },
      include: { role: { select: { id: true, code: true } } },
    });
  }

  async findById(id: number) {
    return this.prisma.user.findUnique({ where: { id: id }, omit: { password: true }, include: { role: { select: { id: true, code: true } } } });
  }

  async findRoleByCode(code: string) {
    return this.prisma.role.findUnique({ where: { code } });
  }

  async findByEmailOrPhone(email: string, phoneNumber: string | null) {
    const or: Prisma.UserWhereInput[] = [{ email }];
    if (phoneNumber) {
      or.push({ phoneNumber });
    }
    return this.prisma.user.findFirst({
      where: { OR: or },
    });
  }

  async signUpUser(data: any, roleId: number): Promise<User> {
    return this.prisma.user.create({
      data: {
        firstname: data.firstname,
        lastname: data.lastname,
        email: data.email,
        ...(data.phoneNumber ? { phoneNumber: data.phoneNumber } : {}),
        password: data.password,
        timezone: data.timezone || "Asia/Almaty",
        hasAcceptedTerms: data.hasAcceptedTerms,
        termsAcceptedAt: data.termsAcceptedAt,
        roleId: roleId,
        portrait: {
          create: { consultationBalance: 2 },
        },
      },
    });
  }
}
