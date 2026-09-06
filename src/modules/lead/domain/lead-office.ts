import { BadRequestException } from "@nestjs/common";
import { Prisma } from "generated/prisma/client";

// Only interpret the known calculator schema; other sources keep their own JSON shape.
/** Checks office selection against known calculator city answers while leaving unknown source schemas uninterpreted. */
export function assertLeadOfficeCity(
  submission: { schemaVersion: string | null; rawPayload: Prisma.JsonValue; normalizedPayload: Prisma.JsonValue | null } | undefined,
  officeCode: string,
) {
  if (!submission || !["office-manual-v2", "landing-calculator-v1"].includes(submission.schemaVersion ?? "")) return;
  const normalized = submission.normalizedPayload as Prisma.JsonObject | null;
  const questionnaire = normalized?.questionnaire as Prisma.JsonObject | undefined;
  const raw = submission.rawPayload as Prisma.JsonObject;
  const answers = questionnaire?.answers ?? raw.answers;
  if (!Array.isArray(answers)) return;
  const city = answers.find(answer => answer && typeof answer === "object" && !Array.isArray(answer) && answer.questionId === "city") as Prisma.JsonObject | undefined;
  const optionIds = city?.optionIds;
  const code = Array.isArray(optionIds) ? optionIds[0] : city?.optionId;
  if (typeof code === "string" && code !== officeCode) throw new BadRequestException("Office must match the lead city. Other cities are served online.");
}
