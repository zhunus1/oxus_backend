import { BadRequestException, ConflictException, Injectable } from "@nestjs/common";
import { Prisma } from "generated/prisma/client";
import { PrismaService } from "src/database/prisma.service";
import { leadTransaction } from "src/modules/lead/domain/lead-transaction";
import { LeadRealtimeGateway } from "src/modules/lead/realtime/lead-realtime.gateway";
import { ConfirmInstallmentDto, ConfirmManualContractDto, RecordContractSignatureDto } from "../api/dto/manual-contract.dto";
import { confirmManualContract, manualContractRead, ownedContract } from "../domain/manual-contract-confirmation";
import { pastPaymentDate } from "../domain/manual-contract";
import { USER_JOURNEY_EVENT } from "src/modules/user-journey/user-journey.constants";

@Injectable()
export class ManualContractService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: LeadRealtimeGateway,
  ) {}

  async confirm(id: string, actorId: number, dto: ConfirmManualContractDto, isAdmin = false) {
    const contract = await leadTransaction(this.prisma, tx => confirmManualContract(tx, id, actorId, dto, isAdmin));
    await this.changed(id);
    return contract;
  }

  async recordSignature(id: string, actorId: number, dto: RecordContractSignatureDto, isAdmin = false) {
    const signedAt = pastPaymentDate(dto.signedAt, "signedAt");
    const result = await leadTransaction(this.prisma, async tx => {
      const { contract } = await ownedContract(tx, id, actorId, isAdmin);
      if (contract.manualConfirmedAt || ["SIGNED", "PAID"].includes(contract.status)) throw new ConflictException("Contract is already finalized");
      if (contract.studentSignedAt?.getTime() === signedAt.getTime()) return contract;
      await tx.auditLog.create({
        data: { userId: actorId, action: "CONTRACT_MANUAL_SIGNATURE", entityType: "User", entityId: contract.studentId, details: { contractId: id, signedAt: dto.signedAt } },
      });
      return tx.contract.update({ where: { id }, data: { studentSignedAt: signedAt }, ...manualContractRead });
    });
    await this.changed(id);
    return result;
  }

  async confirmInstallment(id: string, number: number, actorId: number, dto: ConfirmInstallmentDto, isAdmin = false) {
    const paidAt = pastPaymentDate(dto.paidAt, "paidAt");
    const contract = await leadTransaction(this.prisma, async tx => {
      const { contract } = await ownedContract(tx, id, actorId, isAdmin);
      if (!contract.manualConfirmedAt) throw new ConflictException("Confirm the contract and first payment first");
      const installment = contract.installments.find(item => item.number === number);
      if (!installment) throw new BadRequestException("Unknown installment number");
      if (!installment.amount.equals(new Prisma.Decimal(dto.amount))) throw new BadRequestException("Amount must equal the scheduled installment");
      if (installment.paidAt) {
        if (installment.paidAt.getTime() !== paidAt.getTime()) throw new ConflictException("Payment already confirmed with another date");
        return contract;
      }
      const previous = contract.installments.filter(item => item.number < number);
      if (previous.some(item => !item.paidAt || item.paidAt > paidAt)) throw new BadRequestException("Confirm installments in chronological order");
      await tx.contractInstallment.update({ where: { id: installment.id }, data: { paidAt, confirmedAt: new Date(), confirmedByUserId: actorId } });
      await tx.userJourneyEvent.create({
        data: {
          userId: contract.studentId,
          eventType: USER_JOURNEY_EVENT.CONTRACT_INSTALLMENT_PAID,
          occurredAt: paidAt,
          eventData: { contractId: id, installmentNumber: number, amount: installment.amount.toString(), currency: contract.currency, actorUserId: actorId, manual: true },
        },
      });
      await tx.auditLog.create({
        data: {
          userId: actorId,
          action: "CONTRACT_INSTALLMENT_PAID",
          entityType: "User",
          entityId: contract.studentId,
          details: { contractId: id, number, paidAt: dto.paidAt, amount: dto.amount },
        },
      });
      const fullyPaid = contract.installments.every(item => item.id === installment.id || item.paidAt);
      return tx.contract.update({ where: { id }, data: fullyPaid ? { status: "PAID", paidAt } : {}, ...manualContractRead });
    });
    await this.changed(id);
    return contract;
  }

  private async changed(contractId: string) {
    const lead = await this.prisma.lead.findUnique({ where: { contractId } });
    if (lead?.assignedExpertUserId) this.realtime.emitExpertLeadUpdated(lead.assignedExpertUserId, lead.id);
    if (lead?.assignedSalesManagerId) this.realtime.emitLeadUpdated(lead.assignedSalesManagerId, lead);
  }
}
