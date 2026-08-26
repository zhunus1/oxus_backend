import { Injectable } from "@nestjs/common";
import { BaseRepository } from "src/database/prisma.repository";
import { Contract, ContractStatus } from "generated/prisma/client";
import { CreateContractForStudentDto } from "../api/dto/create-contract-for-student.dto";

const CONTRACT_INCLUDE = {
  student: { select: { id: true, firstname: true, lastname: true, email: true, phoneNumber: true } },
  signedByUser: { select: { id: true, firstname: true, lastname: true, email: true } },
} as const;

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

  async findAllByStatus(status?: ContractStatus): Promise<Contract[]> {
    return this.prisma.contract.findMany({
      where: status ? { status } : undefined,
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

  async expertSign(id: string, expertUserId: number): Promise<Contract> {
    return this.prisma.contract.update({
      where: { id },
      data: {
        signedByUserId: expertUserId,
        status: ContractStatus.PENDING_STUDENT,
        expertSignedAt: new Date(),
        expertOtpHash: null,
        expertOtpExpiry: null,
      },
      include: CONTRACT_INCLUDE,
    });
  }

  async studentSign(
    id: string,
    data: {
      clientFullName: string;
      studentName: string;
      clientIin: string;
      clientAddress: string;
      clientPhone: string;
    },
  ): Promise<Contract> {
    return this.prisma.contract.update({
      where: { id },
      data: {
        ...data,
        status: ContractStatus.SIGNED,
        studentSignedAt: new Date(),
        studentOtpHash: null,
        studentOtpExpiry: null,
      },
      include: CONTRACT_INCLUDE,
    });
  }

  async updateMeta(id: string, data: { contractNumber?: string; price?: number; currency?: string; serviceStartDate?: Date; serviceEndDate?: Date }): Promise<Contract> {
    return this.prisma.contract.update({
      where: { id },
      data: {
        ...(data.contractNumber && { contractNumber: data.contractNumber }),
        ...(data.price !== undefined && { price: data.price }),
        ...(data.currency && { currency: data.currency }),
        ...(data.serviceStartDate && { serviceStartDate: data.serviceStartDate }),
        ...(data.serviceEndDate && { serviceEndDate: data.serviceEndDate }),
      },
      include: CONTRACT_INCLUDE,
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
