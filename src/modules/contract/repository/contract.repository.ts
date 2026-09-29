import { contractInternalOmit, SafeContract } from "../domain/contract-read";
import { commercialTerms } from "../domain/manual-contract";
import { pageBounds, PageQueryDto } from "src/common/dto/page-query.dto";
import { recordContractEmails } from "../domain/contract-emails";
import { leadTransaction } from "src/modules/lead/domain/lead-transaction";
import { leadStatusUpdate } from "src/modules/lead/domain/lead-status";
import { TIER_SLOTS } from "src/modules/studentportrait/domain/contract-benefits";
import { BadRequestException, ConflictException, Injectable } from "@nestjs/common";
import { BaseRepository } from "src/database/prisma.repository";
import { ContractStatus } from "generated/prisma/client";
import { CreateContractForStudentDto } from "../api/dto/create-contract-for-student.dto";
import { assertContractAccess, assertStudentContractCreation, assertStudentContractRead, contractAccessWhere, contractActor } from "../domain/contract-access";
import { lockStudentWithoutContract, nextContractNumber } from "../domain/contract-creation";

export const CONTRACT_INCLUDE = {
  installments: { orderBy: { number: "asc" as const } },
  student: { select: { id: true, firstname: true, lastname: true, middlename: true, email: true, phoneNumber: true } },
  signedByUser: { select: { id: true, firstname: true, lastname: true, email: true } },
} as const;

/** Persists contracts and atomically applies CRM conversion when the student signs. */
@Injectable()
export class ContractRepository extends BaseRepository {
  async assertStudentRead(studentId: number, contractId?: string) {
    await assertStudentContractRead(this.prisma, studentId, contractId);
  }

  async findByStudentId(studentId: number): Promise<SafeContract | null> {
    return this.prisma.contract.findFirst({
      where: { studentId },
      orderBy: { createdAt: "desc" },
      omit: contractInternalOmit,
      include: CONTRACT_INCLUDE,
    });
  }

  async findById(id: string): Promise<SafeContract | null> {
    return this.prisma.contract.findUnique({
      where: { id },
      omit: contractInternalOmit,
      include: CONTRACT_INCLUDE,
    });
  }

  /** Internal legacy OTP verification only; never return this projection to API consumers. */
  findStudentSigningCredentials(id: string) {
    return this.prisma.contract.findUnique({
      where: { id },
      select: { id: true, studentId: true, status: true, studentOtpHash: true, studentOtpExpiry: true },
    });
  }

  async findPendingStudent(): Promise<SafeContract[]> {
    return this.prisma.contract.findMany({
      where: { status: ContractStatus.PENDING_STUDENT },
      omit: contractInternalOmit,
      include: { student: CONTRACT_INCLUDE.student },
      orderBy: { expertSignedAt: "asc" },
    });
  }

  /** Filters both CRM and legacy contracts by current operational ownership. */
  async findAllByStatus(status: ContractStatus | undefined, actorId: number, query: Partial<PageQueryDto> = {}) {
    const { page, limit, skip } = pageBounds(query);
    const actor = await contractActor(this.prisma, actorId);
    const where = { ...(status ? { status } : {}), ...contractAccessWhere(actor) };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.contract.findMany({
        where,
        skip,
        take: limit,
        omit: contractInternalOmit,
        include: { student: { select: { id: true, firstname: true, lastname: true, middlename: true, email: true } } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      }),
      this.prisma.contract.count({ where }),
    ]);
    return { data, total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) };
  }

  async create(dto: CreateContractForStudentDto, actorId: number): Promise<SafeContract> {
    return leadTransaction(this.prisma, async tx => {
      await assertStudentContractCreation(tx, dto.studentId, actorId);
      await lockStudentWithoutContract(tx, dto.studentId);
      const contractNumber = dto.contractNumber ?? (await nextContractNumber(tx));
      return tx.contract.create({
        data: {
          contractNumber,
          studentId: dto.studentId,
          ...commercialTerms(dto.price, dto.currency, dto.subscriptionTier, dto.paymentType, dto.installmentCount),
          subscriptionTier: dto.subscriptionTier,
          price: dto.price,
          currency: dto.currency,
          status: ContractStatus.PENDING_EXPERT,
          ...(dto.serviceStartDate && { serviceStartDate: new Date(dto.serviceStartDate) }),
          ...(dto.serviceEndDate && { serviceEndDate: new Date(dto.serviceEndDate) }),
        },
        omit: contractInternalOmit,
        include: CONTRACT_INCLUDE,
      });
    });
  }

  async saveExpertOtp(id: string, otpHash: string, expiry: Date): Promise<void> {
    await this.prisma.contract.update({
      where: { id },
      data: { expertOtpHash: otpHash, expertOtpExpiry: expiry },
    });
  }

  async saveStudentOtp(id: string, otpHash: string, expiry: Date): Promise<void> {
    await this.prisma.contract.update({
      where: { id },
      data: { studentOtpHash: otpHash, studentOtpExpiry: expiry },
    });
  }

  /** Atomically records the expert signature and durable student notification after checking ownership. */
  async expertSign(id: string, expertUserId: number): Promise<SafeContract> {
    return leadTransaction(this.prisma, async tx => {
      await assertContractAccess(tx, id, expertUserId, "manage");
      const contract = await tx.contract.findUniqueOrThrow({ where: { id } });
      if (contract.status !== ContractStatus.PENDING_EXPERT) throw new ConflictException("Contract has already changed");
      const signed = await tx.contract.update({
        where: { id },
        data: { signedByUserId: expertUserId, status: ContractStatus.PENDING_STUDENT, expertSignedAt: new Date(), expertOtpHash: null, expertOtpExpiry: null },
        omit: contractInternalOmit,
        include: CONTRACT_INCLUDE,
      });
      await recordContractEmails(tx, signed, "CONTRACT_READY");
      return signed;
    });
  }

  /** Finalizes a CRM contract, verifies the signing state, and grants assignment and benefits exactly once. */
  async studentSign(
    id: string,
    data: {
      clientFullName: string;
      studentName: string;
      clientIin: string;
      clientAddress: string;
      clientPhone: string;
    },
    expectedOtpHash?: string,
  ): Promise<SafeContract> {
    return leadTransaction(this.prisma, async tx => {
      const lead = await tx.lead.findUnique({ where: { contractId: id } });
      const contract = await tx.contract.findUniqueOrThrow({ where: { id } });
      if (contract.status !== ContractStatus.PENDING_STUDENT || (lead && lead.status !== "CONTRACT_PENDING")) throw new ConflictException("Contract has already changed");
      if (expectedOtpHash && (contract.studentOtpHash !== expectedOtpHash || !contract.studentOtpExpiry || contract.studentOtpExpiry < new Date()))
        throw new ConflictException("Signing code has changed or expired");
      if (!lead) {
        const signed = await tx.contract.update({
          where: { id },
          data: { ...data, status: ContractStatus.SIGNED, studentSignedAt: new Date(), studentOtpHash: null, studentOtpExpiry: null },
          omit: contractInternalOmit,
          include: CONTRACT_INCLUDE,
        });
        await recordContractEmails(tx, signed, "CONTRACT_SIGNED_COPY");
        return signed;
      }
      if (!lead.assignedExpertUserId || contract.signedByUserId !== lead.assignedExpertUserId) throw new ConflictException("Contract signer must match the assigned expert");
      const expert = await tx.consultantProfile.findUnique({ where: { userId: lead.assignedExpertUserId } });
      if (!expert) throw new ConflictException("Expert profile is missing");
      const portrait = await tx.studentPortrait.findUniqueOrThrow({ where: { userId: contract.studentId } });
      if (portrait.consultantProfileId && portrait.consultantProfileId !== expert.id) throw new ConflictException("Student is now assigned to another expert");
      const signed = await tx.contract.update({
        where: { id },
        data: { ...data, status: ContractStatus.SIGNED, studentSignedAt: new Date(), studentOtpHash: null, studentOtpExpiry: null },
        omit: contractInternalOmit,
        include: CONTRACT_INCLUDE,
      });
      await recordContractEmails(tx, signed, "CONTRACT_SIGNED_COPY");
      await tx.studentPortrait.update({ where: { userId: contract.studentId }, data: { subscription: contract.subscriptionTier, consultantProfileId: expert.id } });
      const totalSlots = TIER_SLOTS[contract.subscriptionTier];
      if (totalSlots)
        await tx.studentPackage.upsert({
          where: { studentId_expertId: { studentId: contract.studentId, expertId: expert.id } },
          create: { studentId: contract.studentId, expertId: expert.id, totalSlots },
          update: { totalSlots: { increment: totalSlots } },
        });
      await tx.lead.update({ where: { id: lead.id }, data: { ...leadStatusUpdate(lead.status, "CONVERTED"), convertedAt: new Date() } });
      await tx.leadActivity.create({
        data: { leadId: lead.id, actorUserId: contract.studentId, type: "LEAD_CONVERTED", metadata: { contractId: id, studentId: contract.studentId } },
      });
      return signed;
    });
  }

  /** Finds the CRM owner and status for a contract without loading a full lead card. */
  findLead(contractId: string) {
    return this.prisma.lead.findUnique({ where: { contractId }, select: { id: true, assignedExpertUserId: true, assignedSalesManagerId: true, status: true } });
  }

  /** Applies the shared ownership rule to both CRM and legacy contracts. */
  async assertLeadExpert(contractId: string, userId: number) {
    await assertContractAccess(this.prisma, contractId, userId);
  }

  /** Validates merged dates under serializable isolation and prevents changes to signed CRM terms. */
  async updateMeta(
    id: string,
    data: {
      contractNumber?: string;
      price?: number;
      currency?: string;
      serviceStartDate?: Date;
      serviceEndDate?: Date;
      paymentType?: "FULL" | "INSTALLMENT";
      installmentCount?: number;
    },
    actorId: number,
  ): Promise<SafeContract> {
    const update = {
      ...(data.contractNumber && { contractNumber: data.contractNumber }),
      ...(data.price !== undefined && { price: data.price }),
      ...(data.currency && { currency: data.currency }),
      ...(data.serviceStartDate && { serviceStartDate: data.serviceStartDate }),
      ...(data.serviceEndDate && { serviceEndDate: data.serviceEndDate }),
    };
    return leadTransaction(this.prisma, async tx => {
      await assertContractAccess(tx, id, actorId, "meta");
      const contract = await tx.contract.findUniqueOrThrow({ where: { id } });
      if (contract.status === ContractStatus.SIGNED || contract.status === ContractStatus.PAID) throw new BadRequestException("Cannot update a fully signed contract");
      if (contract.studentSignedAt) throw new ConflictException("Manually signed terms cannot be changed");
      const terms =
        data.price !== undefined || data.currency !== undefined || data.paymentType !== undefined || data.installmentCount !== undefined
          ? commercialTerms(
              data.price ?? contract.price,
              data.currency ?? contract.currency,
              contract.subscriptionTier,
              data.paymentType ?? contract.paymentType ?? "FULL",
              data.installmentCount ?? (data.paymentType === "FULL" ? 1 : (contract.installmentCount ?? undefined)),
              data.price === undefined && data.currency === undefined,
            )
          : {};
      const start = data.serviceStartDate ?? contract.serviceStartDate;
      const end = data.serviceEndDate ?? contract.serviceEndDate;
      if ((start && !Number.isFinite(start.getTime())) || (end && !Number.isFinite(end.getTime())) || (start && end && end <= start))
        throw new BadRequestException("Service end date must be after service start date");
      return tx.contract.update({ where: { id }, data: { ...update, ...terms }, omit: contractInternalOmit, include: CONTRACT_INCLUDE });
    });
  }

  async isFullySigned(studentId: number): Promise<boolean> {
    const contract = await this.prisma.contract.findFirst({
      where: { studentId, status: { in: [ContractStatus.SIGNED, ContractStatus.PAID] } },
    });
    return contract !== null;
  }

  async usesManualPayments(studentId: number): Promise<boolean> {
    return !!(await this.prisma.contract.findFirst({ where: { studentId, OR: [{ paymentType: { not: null } }, { manualConfirmedAt: { not: null } }] }, select: { id: true } }));
  }

  async markPaidForStudent(studentId: number): Promise<number> {
    const res = await this.prisma.contract.updateMany({
      where: { studentId, status: ContractStatus.SIGNED, manualConfirmedAt: null, paymentType: null },
      data: { status: ContractStatus.PAID, paidAt: new Date() },
    });
    return res.count;
  }
}
