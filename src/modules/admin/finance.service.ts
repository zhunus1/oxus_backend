import { Injectable, NotFoundException } from "@nestjs/common";
import { ContractStatus, Prisma } from "generated/prisma/client";
import { PrismaService } from "src/database/prisma.service";
import type { FinanceContractsQueryDto } from "./api/dto/finance-contracts-query.dto";
import { pageBounds, PageQueryDto } from "src/common/dto/page-query.dto";
import { expertEarningsTotalsQuery } from "./finance-earnings.query";

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
  paidAmount: number;
  remainingAmount: number;
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
    installments?: { amount: Prisma.Decimal; paidAt: Date | null }[];
    student: { id: number; firstname: string; lastname: string; email: string };
    signedByUser: {
      id: number;
      firstname: string;
      lastname: string;
      email: string;
    } | null;
  }): ContractWithDetailsDto {
    const paidAmount = row.installments?.length
      ? row.installments
          .filter(item => item.paidAt)
          .reduce((sum, item) => sum.add(item.amount), new Prisma.Decimal(0))
          .toNumber()
      : row.status === ContractStatus.PAID
        ? row.price
        : 0;
    return {
      paidAmount,
      remainingAmount: new Prisma.Decimal(row.price).sub(paidAmount).toNumber(),
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
          installments: { select: { amount: true, paidAt: true } },
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
    // Aggregate receipts per contract before grouping: a paid manual contract must not also
    // contribute its full price as a second receipt. Currency is part of every money group.
    const rows = await this.prisma.$queryRaw<
      {
        expertId: number | null;
        currency: string;
        status: ContractStatus;
        count: bigint;
        price: Prisma.Decimal;
        paid: Prisma.Decimal;
      }[]
    >`
      SELECT c."signedByUserId" AS "expertId", c.currency, c.status, COUNT(*) AS count,
        SUM(c.price::numeric) AS price,
        SUM(CASE WHEN i."contractId" IS NOT NULL THEN i.paid
          WHEN c.status = 'PAID' THEN c.price::numeric ELSE 0 END) AS paid
      FROM "Contract" c
      LEFT JOIN (
        SELECT "contractId", COALESCE(SUM(amount) FILTER (WHERE "paidAt" IS NOT NULL), 0) AS paid
        FROM "ContractInstallment" GROUP BY "contractId"
      ) i ON i."contractId" = c.id
      GROUP BY c."signedByUserId", c.currency, c.status
    `;
    const financialRows = rows.map(row => ({
      ...row,
      totalSignedAmount: ["SIGNED", "PAID"].includes(row.status) ? row.price : 0,
      totalPaidAmount: row.paid,
      signedUnpaidAmount: row.status === ContractStatus.SIGNED ? new Prisma.Decimal(row.price).sub(row.paid) : 0,
    }));
    const expertIds = [...new Set(rows.filter(row => row.expertId !== null && ["SIGNED", "PAID"].includes(row.status)).map(row => row.expertId!))];
    const [experts, expertOptions] = await Promise.all([
      this.prisma.user.findMany({
        where: { id: { in: expertIds } },
        select: { id: true, firstname: true, lastname: true, email: true },
        orderBy: [{ lastname: "asc" }, { firstname: "asc" }],
      }),
      this.prisma.user.findMany({
        where: { role: { code: "EXPERT" } },
        select: { id: true, firstname: true, lastname: true, email: true },
        orderBy: [{ lastname: "asc" }, { firstname: "asc" }],
      }),
    ]);
    const countByStatus: Record<string, number> = {};
    for (const row of rows) countByStatus[row.status] = (countByStatus[row.status] ?? 0) + Number(row.count);
    return {
      ...moneySummary(financialRows),
      totalSignedContracts: (countByStatus.SIGNED ?? 0) + (countByStatus.PAID ?? 0),
      paidContractsCount: countByStatus.PAID ?? 0,
      totalContracts: rows.reduce((sum, row) => sum + Number(row.count), 0),
      expertsWithContracts: new Set(rows.filter(row => row.expertId !== null).map(row => row.expertId)).size,
      countByStatus,
      expertOptions,
      earningsByExpert: experts.map(expert => {
        const own = financialRows.filter(row => row.expertId === expert.id);
        return {
          ...expert,
          ...moneySummary(own),
          contractCount: own.filter(row => ["SIGNED", "PAID"].includes(row.status)).reduce((sum, row) => sum + Number(row.count), 0),
          paidContractCount: own.filter(row => row.status === "PAID").reduce((sum, row) => sum + Number(row.count), 0),
        };
      }),
    };
  }

  async getExpertEarnings(expertId: number, query: Partial<PageQueryDto> = {}) {
    const { page, limit, skip } = pageBounds(query);
    const expert = await this.prisma.user.findFirst({
      where: { id: expertId, role: { code: "EXPERT" } },
      select: { id: true, firstname: true, lastname: true, email: true },
    });
    if (!expert) {
      throw new NotFoundException(`Expert with id ${expertId} not found`);
    }

    const [contracts, groups] = await this.prisma.$transaction([
      this.prisma.contract.findMany({
        where: { signedByUserId: expertId },
        skip,
        take: limit,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        include: {
          installments: { select: { amount: true, paidAt: true } },
          student: {
            select: { id: true, firstname: true, lastname: true, email: true },
          },
          signedByUser: {
            select: { id: true, firstname: true, lastname: true, email: true },
          },
        },
      }),
      this.prisma.$queryRaw<{ currency: string; count: bigint; totalSignedAmount: Prisma.Decimal; totalPaidAmount: Prisma.Decimal; signedUnpaidAmount: Prisma.Decimal }[]>(
        expertEarningsTotalsQuery(expertId),
      ),
    ]);

    const mapped = contracts.map(r => this.mapContract(r));
    const amounts = moneySummary(groups);
    const total = groups.reduce((sum, group) => sum + Number(group.count), 0);
    return {
      expert,
      totals: {
        allContracts: total,
        currency: amounts.currency,
        paidAmount: amounts.totalPaidAmount,
        signedUnpaidAmount: amounts.signedUnpaidAmount,
        byCurrency: amounts.byCurrency.map(row => ({ currency: row.currency, paidAmount: row.totalPaidAmount, signedUnpaidAmount: row.signedUnpaidAmount })),
      },
      contracts: mapped,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }
}

/** Retain numeric legacy totals only when one currency makes them meaningful. */
function moneySummary(
  rows: { currency: string; totalSignedAmount: Prisma.Decimal | number; totalPaidAmount: Prisma.Decimal | number; signedUnpaidAmount: Prisma.Decimal | number }[],
) {
  const groups = new Map<string, { totalSignedAmount: Prisma.Decimal; totalPaidAmount: Prisma.Decimal; signedUnpaidAmount: Prisma.Decimal }>();
  for (const row of rows) {
    const previous = groups.get(row.currency);
    groups.set(row.currency, {
      totalSignedAmount: new Prisma.Decimal(previous?.totalSignedAmount ?? 0).add(row.totalSignedAmount),
      totalPaidAmount: new Prisma.Decimal(previous?.totalPaidAmount ?? 0).add(row.totalPaidAmount),
      signedUnpaidAmount: new Prisma.Decimal(previous?.signedUnpaidAmount ?? 0).add(row.signedUnpaidAmount),
    });
  }
  const byCurrency = [...groups]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, row]) => ({
      currency,
      totalSignedAmount: row.totalSignedAmount.toNumber(),
      totalPaidAmount: row.totalPaidAmount.toNumber(),
      signedUnpaidAmount: row.signedUnpaidAmount.toNumber(),
    }));
  return {
    currency: byCurrency.length === 1 ? byCurrency[0].currency : null,
    totalSignedAmount: byCurrency.length > 1 ? null : (byCurrency[0]?.totalSignedAmount ?? 0),
    totalPaidAmount: byCurrency.length > 1 ? null : (byCurrency[0]?.totalPaidAmount ?? 0),
    signedUnpaidAmount: byCurrency.length > 1 ? null : (byCurrency[0]?.signedUnpaidAmount ?? 0),
    byCurrency,
  };
}
