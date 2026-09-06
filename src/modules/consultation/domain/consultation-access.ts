import { ForbiddenException } from "@nestjs/common";
import type { Prisma } from "generated/prisma/client";

/** Authenticated identity supplied by the HTTP guard, never by the request body. */
export type ConsultationActor = { id: number; roleCode: string };

/** Restricts ordinary consultations to administrators or their student/expert participants. */
export function consultationScope(actor: ConsultationActor): Prisma.ConsultationWhereInput {
  switch (actor.roleCode) {
    case "ADMIN":
      return {};
    case "EXPERT":
      return { consultant: { userId: actor.id } };
    case "STUDENT":
    case "SCHOOLBOY":
      return { clientId: actor.id };
    default:
      throw new ForbiddenException("Ordinary consultations are available only to their participants and administrators");
  }
}
