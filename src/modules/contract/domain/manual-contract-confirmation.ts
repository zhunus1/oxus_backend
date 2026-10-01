import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { Prisma } from "generated/prisma/client";
import { leadStatusUpdate } from "src/modules/lead/domain/lead-status";
import { TIER_SLOTS } from "src/modules/studentportrait/domain/contract-benefits";
import { ConfirmManualContractDto } from "../api/dto/manual-contract.dto";
import { commercialTerms, installmentSchedule, pastPaymentDate } from "./manual-contract";
import { assertHistoricalBenefits } from "./historical-contract-benefits";
import { assertContractAccess } from "./contract-access";
import { contractJourneyMilestone } from "./contract-journey";
import { contractInternalOmit } from "./contract-read";
import { USER_JOURNEY_EVENT } from "src/modules/user-journey/user-journey.constants";

export const manualContractRead = {
  include: { installments: { orderBy: { number: "asc" } } },
  omit: contractInternalOmit,
} as const;

export async function ownedContract(tx: Prisma.TransactionClient, id: string, actorId: number, isAdmin = false) {
  // isAdmin is retained for internal call compatibility; authority always comes from the database.
  const actor = await assertContractAccess(tx, id, actorId, "manage");
  if (isAdmin && !actor.isAdmin) throw new ForbiddenException("Administrator access required");
  const contract = await tx.contract.findUnique({ where: { id }, ...manualContractRead });
  if (!contract) throw new NotFoundException("Contract not found");
  const lead = await tx.lead.findUnique({ where: { contractId: id } });
  const portrait = await tx.studentPortrait.findUnique({ where: { userId: contract.studentId }, include: { assignedExpert: { select: { userId: true } } } });
  const ownerId = portrait?.assignedExpert?.userId ?? (lead?.status === "CONTRACT_PENDING" ? lead.assignedExpertUserId : null);
  return { contract, lead, portrait, expertUserId: ownerId ?? (actor.isAdmin ? null : actorId) };
}

/** Called only inside a serializable transaction. A signature alone never grants benefits. */
export async function confirmManualContract(tx: Prisma.TransactionClient, id: string, actorId: number, dto: ConfirmManualContractDto, isAdmin = false) {
  const { contract, lead, portrait, expertUserId } = await ownedContract(tx, id, actorId, isAdmin);
  if (contract.manualConfirmedAt) {
    const first = contract.installments[0];
    if (
      !first?.paidAt ||
      first.paidAt.getTime() !== pastPaymentDate(dto.paidAt, "paidAt").getTime() ||
      !first.amount.equals(dto.amount) ||
      (dto.signedAt && contract.studentSignedAt?.getTime() !== pastPaymentDate(dto.signedAt, "signedAt").getTime())
    )
      throw new ConflictException("Contract already confirmed with different signature or payment details");
    return contract;
  }
  if (contract.status === "PAID") throw new ConflictException("This historical contract is already fully paid");
  if (contract.status === "SIGNED") await assertHistoricalBenefits(tx, contract, portrait);
  if (lead && !["CONTRACT_PENDING", "CONVERTED"].includes(lead.status)) throw new ConflictException("Lead is not awaiting contract confirmation");
  const signature = dto.signedAt ?? contract.studentSignedAt;
  if (!signature) throw new BadRequestException("Confirm the manual signature first");
  const signedAt = pastPaymentDate(signature, "signedAt");
  const paidAt = pastPaymentDate(dto.paidAt, "paidAt");
  const terms = commercialTerms(contract.price, contract.currency, contract.subscriptionTier, contract.paymentType ?? "FULL", contract.installmentCount ?? undefined, true);
  const schedule = installmentSchedule(contract.price, terms.installmentCount, paidAt);
  if (!new Prisma.Decimal(dto.amount).equals(schedule[0].amount)) throw new BadRequestException(`First payment must equal ${schedule[0].amount.toString()} ${contract.currency}`);
  const expert = expertUserId ? await tx.consultantProfile.findUnique({ where: { userId: expertUserId } }) : null;
  if (lead && !expert) throw new ConflictException("Expert profile is missing");
  if (portrait?.consultantProfileId && portrait.consultantProfileId !== expert?.id) throw new ConflictException("Student belongs to another expert");
  const now = new Date();
  await tx.contractInstallment.createMany({
    data: schedule.map((item, index) => ({
      ...item,
      contractId: id,
      ...(index === 0 ? { paidAt, confirmedAt: now, confirmedByUserId: actorId } : {}),
    })),
  });
  // Historical SIGNED passed the observable-benefits guard; never grant again here.
  if (contract.status !== "SIGNED") {
    await tx.studentPortrait.upsert({
      where: { userId: contract.studentId },
      create: { userId: contract.studentId, subscription: contract.subscriptionTier, consultantProfileId: expert?.id },
      update: { subscription: contract.subscriptionTier, ...(expert ? { consultantProfileId: expert.id } : {}) },
    });
    const totalSlots = TIER_SLOTS[contract.subscriptionTier];
    if (totalSlots && expert)
      await tx.studentPackage.upsert({
        where: { studentId_expertId: { studentId: contract.studentId, expertId: expert.id } },
        create: { studentId: contract.studentId, expertId: expert.id, totalSlots },
        update: { totalSlots: { increment: totalSlots } },
      });
  }
  if (lead && lead.status !== "CONVERTED") {
    await tx.lead.update({ where: { id: lead.id }, data: { ...leadStatusUpdate(lead.status, "CONVERTED"), convertedAt: now } });
    await tx.leadActivity.create({
      data: { leadId: lead.id, actorUserId: actorId, type: "LEAD_CONVERTED", metadata: { contractId: id, studentId: contract.studentId, manual: true } },
    });
    await contractJourneyMilestone(tx, contract.studentId, USER_JOURNEY_EVENT.LEAD_CONVERTED, now, { leadId: lead.id, contractId: id, actorUserId: actorId, manual: true });
  }
  await contractJourneyMilestone(tx, contract.studentId, USER_JOURNEY_EVENT.CONTRACT_SIGNED, signedAt, { contractId: id, actorUserId: actorId, manual: true });
  await contractJourneyMilestone(tx, contract.studentId, USER_JOURNEY_EVENT.PAYMENT_COMPLETED, paidAt, {
    contractId: id,
    actorUserId: actorId,
    manual: true,
    installmentNumber: 1,
    amount: schedule[0].amount.toString(),
    currency: contract.currency,
  });
  await tx.auditLog.create({
    data: {
      userId: actorId,
      action: "CONTRACT_MANUALLY_CONFIRMED",
      entityType: "User",
      entityId: contract.studentId,
      details: { contractId: id, signedAt: signedAt.toISOString(), paidAt: paidAt.toISOString(), amount: dto.amount },
    },
  });
  return tx.contract.update({
    where: { id },
    data: {
      ...terms,
      status: terms.installmentCount === 1 ? "PAID" : "SIGNED",
      paidAt: terms.installmentCount === 1 ? paidAt : null,
      studentSignedAt: signedAt,
      expertSignedAt: contract.expertSignedAt ?? signedAt,
      signedByUserId: contract.signedByUserId ?? lead?.assignedExpertUserId ?? expertUserId,
      manualConfirmedAt: now,
      studentOtpHash: null,
      studentOtpExpiry: null,
      expertOtpHash: null,
      expertOtpExpiry: null,
    },
    ...manualContractRead,
  });
}
