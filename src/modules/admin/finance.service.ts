import { Injectable, NotFoundException } from "@nestjs/common";
import { ContractStatus, Prisma } from "generated/prisma/client";
import { PrismaService } from "src/database/prisma.service";
import type { FinanceContractsQueryDto } from "./api/dto/finance-contracts-query.dto";

export type ContractWithDetailsDto = {
  id: string;
  contractNumber: string;
  student: {
    id: number;
    firstname: string;
    lastname: string;
    email: string;
  };
  expert: {
    id: number;
    firstname: string;
    lastname: string;
    email: string;
  } | null;
  amount: number;
  currency: string;
  subscriptionTier: string;
  status: ContractStatus;
  studentSignedAt: string | null;
  expertSignedAt: string | null;
  paidAt: string | null;
  createdAt: string;
};

@Injectable()
export class FinanceService {
  constructor(private readonly prisma: PrismaService) {}

  private mapContract(row: {
    id: string;
    contractNumber: string;
    price: number;
    currency: string;
    subscriptionTier: string;
    status: ContractStatus;
    studentSignedAt: Date | null;
    expertSignedAt: Date | null;
    paidAt: Date | null;
    createdAt: Date;
    student: { id: number; firstname: string; lastname: string; email: string };
    signedByUser: {
      id: number;
      firstname: string;
      lastname: string;
      email: string;
    } | null;
  }): ContractWithDetailsDto {
    return {
      id: row.id,
      contractNumber: row.contractNumber,
      student: row.student,
      expert: row.signedByUser,
      amount: row.price,
      currency: row.currency,
      subscriptionTier: row.subscriptionTier,
      status: row.status,
      studentSignedAt: row.studentSignedAt?.toISOString() ?? null,
      expertSignedAt: row.expertSignedAt?.toISOString() ?? null,
      paidAt: row.paidAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private buildWhere(q: FinanceContractsQueryDto): Prisma.ContractWhereInput {
    const where: Prisma.ContractWhereInput = {};
    if (q.status) where.status = q.status;
    if (q.expertId) where.signedByUserId = q.expertId;
    if (q.studentId) where.studentId = q.studentId;
    if (q.dateFrom || q.dateTo) {
      where.createdAt = {};
      if (q.dateFrom) {
        const d = new Date(q.dateFrom);
        d.setUTCHours(0, 0, 0, 0);
        where.createdAt.gte = d;
      }
      if (q.dateTo) {
        const d = new Date(q.dateTo);
        d.setUTCHours(23, 59, 59, 999);
        where.createdAt.lte = d;
      }
    }
    return where;
  }

  async listContracts(q: FinanceContractsQueryDto) {
    const page = q.page ?? 1;
    const limit = q.limit ?? 20;
    const skip = (page - 1) * limit;
    const where = this.buildWhere(q);

    const orderBy: Prisma.ContractOrderByWithRelationInput = {
      [q.sortBy]: q.sortOrder,
    };

    const [rows, total] = await Promise.all([
      this.prisma.contract.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: {
          student: {
            select: { id: true, firstname: true, lastname: true, email: true },
          },
          signedByUser: {
            select: { id: true, firstname: true, lastname: true, email: true },
          },
        },
      }),
      this.prisma.contract.count({ where }),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / limit));

    return {
      data: rows.map(r => this.mapContract(r)),
      total,
      page,
      totalPages,
    };
  }

  async getSummary() {
    const [signedFinancial, paidFinancial, statusGroups, distinctExperts] = await Promise.all([
      this.prisma.contract.aggregate({
        where: {
          status: { in: [ContractStatus.SIGNED, ContractStatus.PAID] },
        },
        _sum: { price: true },
        _count: { _all: true },
      }),
      this.prisma.contract.aggregate({
        where: { status: ContractStatus.PAID },
        _sum: { price: true },
        _count: { _all: true },
      }),
      this.prisma.contract.groupBy({
        by: ["status"],
        _count: { _all: true },
      }),
      this.prisma.contract.findMany({
        where: { signedByUserId: { not: null } },
        select: { signedByUserId: true },
        distinct: ["signedByUserId"],
      }),
    ]);

    const expertOptions = await this.prisma.user.findMany({
      where: { role: { code: "EXPERT" } },
      select: { id: true, firstname: true, lastname: true, email: true },
      orderBy: [{ lastname: "asc" }, { firstname: "asc" }],
    });

    const countByStatus: Record<string, number> = {};
    for (const g of statusGroups) {
      countByStatus[g.status] = g._count._all;
    }

    const paidByExpert = await this.prisma.contract.groupBy({
      by: ["signedByUserId"],
      where: { signedByUserId: { not: null }, status: ContractStatus.PAID },
      _sum: { price: true },
      _count: { _all: true },
    });

    const allSignedByExpert = await this.prisma.contract.groupBy({
      by: ["signedByUserId"],
      where: {
        signedByUserId: { not: null },
        status: { in: [ContractStatus.SIGNED, ContractStatus.PAID] },
      },
      _sum: { price: true },
      _count: { _all: true },
    });

    const paidMap = new Map(paidByExpert.map(x => [x.signedByUserId as number, { sum: x._sum.price ?? 0, count: x._count._all }]));

    const allSignedMap = new Map(allSignedByExpert.map(x => [x.signedByUserId as number, { sum: x._sum.price ?? 0, count: x._count._all }]));

    const expertIds = new Set<number>();
    for (const x of allSignedByExpert) {
      if (x.signedByUserId != null) expertIds.add(x.signedByUserId);
    }

    const experts = await this.prisma.user.findMany({
      where: { id: { in: [...expertIds] } },
      select: { id: true, firstname: true, lastname: true, email: true },
      orderBy: [{ lastname: "asc" }, { firstname: "asc" }],
    });

    const earningsByExpert = experts.map(u => {
      const signedTotal = allSignedMap.get(u.id)?.sum ?? 0;
      const paidTotal = paidMap.get(u.id)?.sum ?? 0;
      const contractCount = allSignedMap.get(u.id)?.count ?? 0;
      const paidCount = paidMap.get(u.id)?.count ?? 0;
      return {
        id: u.id,
        firstname: u.firstname,
        lastname: u.lastname,
        email: u.email,
        totalSignedAmount: signedTotal,
        totalPaidAmount: paidTotal,
        contractCount,
        paidContractCount: paidCount,
      };
    });

    return {
      totalSignedAmount: signedFinancial._sum.price ?? 0,
      totalSignedContracts: signedFinancial._count._all,
      totalPaidAmount: paidFinancial._sum.price ?? 0,
      paidContractsCount: paidFinancial._count._all,
      totalContracts: await this.prisma.contract.count(),
      expertsWithContracts: distinctExperts.length,
      countByStatus,
      expertOptions,
      earningsByExpert,
    };
  }

  async getExpertEarnings(expertId: number) {
    const expert = await this.prisma.user.findFirst({
      where: { id: expertId, role: { code: "EXPERT" } },
      select: { id: true, firstname: true, lastname: true, email: true },
    });
    if (!expert) {
      throw new NotFoundException(`Expert with id ${expertId} not found`);
    }

    const contracts = await this.prisma.contract.findMany({
      where: { signedByUserId: expertId },
      orderBy: { createdAt: "desc" },
      include: {
        student: {
          select: { id: true, firstname: true, lastname: true, email: true },
        },
        signedByUser: {
          select: { id: true, firstname: true, lastname: true, email: true },
        },
      },
    });

    const mapped = contracts.map(r => this.mapContract(r));
    const paidTotal = mapped.filter(c => c.status === ContractStatus.PAID).reduce((s, c) => s + c.amount, 0);
    const signedUnpaidTotal = mapped.filter(c => c.status === ContractStatus.SIGNED).reduce((s, c) => s + c.amount, 0);

    return {
      expert,
      totals: {
        allContracts: mapped.length,
        paidAmount: paidTotal,
        signedUnpaidAmount: signedUnpaidTotal,
      },
      contracts: mapped,
    };
  }
}
