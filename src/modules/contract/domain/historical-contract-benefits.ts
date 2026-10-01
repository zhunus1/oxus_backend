import { ConflictException } from "@nestjs/common";
import { Contract, Prisma, StudentPortrait } from "generated/prisma/client";
import { TIER_SLOTS } from "src/modules/studentportrait/domain/contract-benefits";

/** No immutable grant ledger exists: missing packages cannot prove benefits were never issued.
 * Accept only a consistent observable entitlement for a single contract and current owner.
 * Fully consumed packages remain valid; transfers/competing contracts require manual review.
 * Called before writes inside the same serializable confirmation transaction.
 */
export async function assertHistoricalBenefits(
  tx: Prisma.TransactionClient,
  contract: Pick<Contract, "id" | "studentId" | "subscriptionTier">,
  portrait: Pick<StudentPortrait, "subscription" | "consultantProfileId"> | null,
) {
  const slots = TIER_SLOTS[contract.subscriptionTier];
  const pkg = portrait?.consultantProfileId
    ? await tx.studentPackage.findUnique({ where: { studentId_expertId: { studentId: contract.studentId, expertId: portrait.consultantProfileId } } })
    : null;
  const competingContract = await tx.contract.findFirst({ where: { studentId: contract.studentId, id: { not: contract.id } }, select: { id: true } });
  if (!slots || portrait?.subscription !== contract.subscriptionTier || !pkg || pkg.totalSlots < slots || pkg.usedSlots < 0 || pkg.usedSlots > pkg.totalSlots || competingContract)
    throw new ConflictException({
      statusCode: 409,
      code: "HISTORICAL_BENEFITS_REVIEW_REQUIRED",
      message: "Historical contract benefits require review before confirming payment",
      contractId: contract.id,
    });
}
