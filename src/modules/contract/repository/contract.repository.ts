import { recordContractEmails } from "../domain/contract-emails";
import { leadTransaction } from "src/modules/lead/domain/lead-transaction";
import { TIER_SLOTS } from "src/modules/studentportrait/domain/contract-benefits";
import { BadRequestException, ConflictException, ForbiddenException, Injectable } from "@nestjs/common";
import { BaseRepository } from "src/database/prisma.repository";
import { Contract, ContractStatus } from "generated/prisma/client";
import { CreateContractForStudentDto } from "../api/dto/create-contract-for-student.dto";

export const CONTRACT_INCLUDE = {
  student: { select: { id: true, firstname: true, lastname: true, email: true, phoneNumber: true } },
  signedByUser: { select: { id: true, firstname: true, lastname: true, email: true } },
} as const;

/** Persists contracts and atomically applies CRM conversion when the student signs. */
@Injectable()
export class ContractRepository extends BaseRepository {
  private async generateContractNumber(): Promise<string> {
    const year = new Date().getFullYear();
    const count = await this.prisma.contract.count();
    const seq = String(count + 1).padStart(4, "0");
    return `OXUS-${year}-${seq}`;
  }

  async findByStudentId(studentId: number): Promise<Contract | null> {
    return this.prisma.contract.findFirst({
      where: { studentId },
      orderBy: { createdAt: "desc" },
      include: CONTRACT_INCLUDE,
    });
  }

  async findById(id: string): Promise<Contract | null> {
    return this.prisma.contract.findUnique({
      where: { id },
      include: CONTRACT_INCLUDE,
    });
  }

  async findPendingStudent(): Promise<Contract[]> {
    return this.prisma.contract.findMany({
      where: { status: ContractStatus.PENDING_STUDENT },
      include: { student: { select: { id: true, firstname: true, lastname: true, email: true, phoneNumber: true } } },
      orderBy: { expertSignedAt: "asc" },
    });
  }

  /** Filters CRM contracts by assigned expert while retaining the legacy contract listing policy. */
  async findAllByStatus(status?: ContractStatus, expertId?: number): Promise<Contract[]> {
    return this.prisma.contract.findMany({
      where: { ...(status ? { status } : {}), ...(expertId ? { OR: [{ lead: null }, { lead: { assignedExpertUserId: expertId } }] } : {}) },
      include: { student: { select: { id: true, firstname: true, lastname: true, email: true } } },
      orderBy: { createdAt: "desc" },
    });
  }

  async create(dto: CreateContractForStudentDto): Promise<Contract> {
    const contractNumber = dto.contractNumber ?? (await this.generateContractNumber());
    return this.prisma.contract.create({
      data: {
        contractNumber,
        studentId: dto.studentId,
        subscriptionTier: dto.subscriptionTier,
        price: dto.price,
        currency: dto.currency,
        status: ContractStatus.PENDING_EXPERT,
        ...(dto.serviceStartDate && { serviceStartDate: new Date(dto.serviceStartDate) }),
        ...(dto.serviceEndDate && { serviceEndDate: new Date(dto.serviceEndDate) }),
      },
      include: CONTRACT_INCLUDE,
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
  async expertSign(id: string, expertUserId: number): Promise<Contract> {
    return leadTransaction(this.prisma, async tx => {
      const lead = await tx.lead.findUnique({ where: { contractId: id } });
      if (lead && lead.assignedExpertUserId !== expertUserId) throw new ForbiddenException("Only the assigned expert may manage this lead contract");
      const contract = await tx.contract.findUniqueOrThrow({ where: { id } });
      if (contract.status !== ContractStatus.PENDING_EXPERT) throw new ConflictException("Contract has already changed");
      const signed = await tx.contract.update({
        where: { id },
        data: { signedByUserId: expertUserId, status: ContractStatus.PENDING_STUDENT, expertSignedAt: new Date(), expertOtpHash: null, expertOtpExpiry: null },
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
  ): Promise<Contract> {
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
      await tx.lead.update({ where: { id: lead.id }, data: { status: "CONVERTED", convertedAt: new Date() } });
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

  /** Restricts a CRM contract to its assigned expert while preserving legacy contract access. */
  async assertLeadExpert(contractId: string, userId?: number) {
    const lead = await this.findLead(contractId);
    if (lead && lead.assignedExpertUserId !== userId) throw new ForbiddenException("Only the assigned expert may manage this lead contract");
  }

  /** Validates merged dates under serializable isolation and prevents changes to signed CRM terms. */
  async updateMeta(id: string, data: { contractNumber?: string; price?: number; currency?: string; serviceStartDate?: Date; serviceEndDate?: Date }): Promise<Contract> {
    const update = {
      ...(data.contractNumber && { contractNumber: data.contractNumber }),
      ...(data.price !== undefined && { price: data.price }),
      ...(data.currency && { currency: data.currency }),
      ...(data.serviceStartDate && { serviceStartDate: data.serviceStartDate }),
      ...(data.serviceEndDate && { serviceEndDate: data.serviceEndDate }),
    };
    return leadTransaction(this.prisma, async tx => {
      const contract = await tx.contract.findUniqueOrThrow({ where: { id } });
      const lead = await tx.lead.findUnique({ where: { contractId: id }, select: { id: true } });
      if (lead && contract.status !== ContractStatus.PENDING_EXPERT) throw new ConflictException("A signed lead contract cannot be changed");
      if (contract.status === ContractStatus.SIGNED || contract.status === ContractStatus.PAID) throw new BadRequestException("Cannot update a fully signed contract");
      const start = data.serviceStartDate ?? contract.serviceStartDate;
      const end = data.serviceEndDate ?? contract.serviceEndDate;
      if ((start && !Number.isFinite(start.getTime())) || (end && !Number.isFinite(end.getTime())) || (start && end && end <= start))
        throw new BadRequestException("Service end date must be after service start date");
      return tx.contract.update({ where: { id }, data: update, include: CONTRACT_INCLUDE });
    });
  }

  async isFullySigned(studentId: number): Promise<boolean> {
    const contract = await this.prisma.contract.findFirst({
      where: { studentId, status: { in: [ContractStatus.SIGNED, ContractStatus.PAID] } },
    });
    return contract !== null;
  }

  async markPaidForStudent(studentId: number): Promise<number> {
    const res = await this.prisma.contract.updateMany({
      where: { studentId, status: ContractStatus.SIGNED },
      data: { status: ContractStatus.PAID, paidAt: new Date() },
    });
    return res.count;
  }
}
