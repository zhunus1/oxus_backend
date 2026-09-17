import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import * as bcrypt from "bcrypt";
import { PrismaService } from "src/database/prisma.service";
import { Prisma } from "generated/prisma/client";
import { PrepareLeadContractDto } from "../api/dto/sales/prepare-lead-contract.dto";
import { normalizePhoneNumber } from "../domain/phone-number";
import { leadTransaction } from "../domain/lead-transaction";
import { leadStatusUpdate } from "../domain/lead-status";
import { LeadRealtimeGateway } from "../realtime/lead-realtime.gateway";
import { LeadStudentInvitationService } from "./lead-student-invitation.service";

/** Converts an expert lead into a pending contract without assigning student benefits before signature. */
@Injectable()
export class LeadContractService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: LeadRealtimeGateway,
    private readonly invitations: LeadStudentInvitationService,
  ) {}

  /** Creates or explicitly reuses a student, freezes questionnaire data, and prepares a contract atomically; retries reuse it. */
  async prepare(expertId: number, leadId: number, dto: PrepareLeadContractDto) {
    const phoneNumber = normalizePhoneNumber(dto.phone);
    const email = dto.email.trim().toLowerCase();
    const middlename = dto.middlename?.trim() || null;
    if (!phoneNumber || !dto.firstname.trim() || !dto.lastname.trim()) throw new BadRequestException("Student name and valid phone are required");
    if (dto.subscriptionTier === "FREE") throw new BadRequestException("Select a paid tariff");
    if (dto.serviceStartDate && dto.serviceEndDate && new Date(dto.serviceEndDate) <= new Date(dto.serviceStartDate))
      throw new BadRequestException("Service end must follow start");
    const password = await bcrypt.hash(randomBytes(32).toString("base64url"), 12);
    const result = await leadTransaction(this.prisma, async tx => {
      const lead = await tx.lead.findFirst({ where: { id: leadId, assignedExpertUserId: expertId, deletedAt: null } });
      if (!lead) throw new NotFoundException("Lead not found");
      if (lead.contractId) {
        const contract = await tx.contract.findUniqueOrThrow({ where: { id: lead.contractId } });
        const invitation = await tx.leadStudentInvitation.findUnique({ where: { userId: contract.studentId } });
        return { lead, contract, invitation };
      }
      if (!["CALL_SCHEDULED", "OFFICE_INVITED", "RECALL"].includes(lead.status)) throw new ConflictException("Lead is not ready for a contract");
      if (await tx.leadExpertCall.findFirst({ where: { leadId, status: "REQUESTED" }, select: { id: true } }))
        throw new ConflictException("Confirm the consultation before preparing a contract");
      const expert = await tx.consultantProfile.findUnique({ where: { userId: expertId } });
      if (!expert) throw new BadRequestException("Expert profile is required");
      const questionnaire = (lead.expertQuestionnaire ?? {}) as Prisma.JsonObject;
      const citizenshipCountryId = typeof questionnaire.citizenshipCountryId === "number" ? questionnaire.citizenshipCountryId : undefined;
      const birthDate = typeof questionnaire.birthDate === "string" ? new Date(questionnaire.birthDate) : undefined;
      const users = await tx.user.findMany({ where: { OR: [{ email: { equals: email, mode: "insensitive" } }, { phoneNumber }] }, include: { role: true, portrait: true } });
      let student = users[0];
      if (users.length) {
        if (users.length !== 1 || student.email.toLowerCase() !== email || student.phoneNumber !== phoneNumber) {
          const emailExists = users.some(user => user.email.toLowerCase() === email);
          throw new ConflictException(emailExists ? "Пользователь с такой электронной почтой уже существует." : "Пользователь с таким номером телефона уже существует.");
        }
        if (student.deletedAt || !["STUDENT", "SCHOOLBOY"].includes(student.role.code)) throw new ConflictException("Account cannot be used as a student");
        if (student.portrait?.consultantProfileId && student.portrait.consultantProfileId !== expert.id)
          throw new ConflictException("Student belongs to another expert; use the existing transfer process");
        if (await tx.contract.findFirst({ where: { studentId: student.id }, select: { id: true } })) throw new ConflictException("Student already has a contract");
        if (dto.existingStudentId !== student.id)
          throw new ConflictException({
            code: "EXISTING_STUDENT_CONFIRMATION_REQUIRED",
            message: "Confirm reuse of the matching student account",
            studentId: student.id,
          });
      } else {
        if (dto.existingStudentId) throw new ConflictException("Existing student does not match supplied contacts");
        const role = await tx.role.findUnique({ where: { code: "STUDENT" } });
        if (!role) throw new ConflictException("Student role is not configured");
        student = await tx.user.create({
          data: { firstname: dto.firstname.trim(), lastname: dto.lastname.trim(), middlename, email, phoneNumber, password, roleId: role.id, citizenshipCountryId },
          include: { role: true, portrait: true },
        });
      }
      if (users.length && !student.portrait?.isIdentityLocked) {
        const identity: Prisma.UserUpdateInput = {
          ...(!student.citizenshipCountryId && citizenshipCountryId ? { citizenshipCountryId } : {}),
          ...(!student.middlename && middlename ? { middlename } : {}),
        };
        if (Object.keys(identity).length) await tx.user.update({ where: { id: student.id }, data: identity });
      }
      const previousMeta = student.portrait?.meta;
      let preservedMeta: Prisma.JsonObject = {};
      if (previousMeta !== null && previousMeta !== undefined) {
        preservedMeta = typeof previousMeta === "object" && !Array.isArray(previousMeta) ? previousMeta : { legacyMeta: previousMeta };
      }
      const meta = {
        ...preservedMeta,
        leadId,
        expertQuestionnaire: questionnaire,
      };
      await tx.studentPortrait.upsert({
        where: { userId: student.id },
        create: {
          userId: student.id,
          birthDate,
          meta,
        },
        update: {
          ...(!student.portrait?.isIdentityLocked && !student.portrait?.birthDate ? { birthDate } : {}),
          meta,
        },
      });
      const contract = await tx.contract.create({
        data: {
          studentId: student.id,
          contractNumber: `OXUS-${new Date().getFullYear()}-CRM-${String(leadId).padStart(6, "0")}`,
          status: "PENDING_EXPERT",
          subscriptionTier: dto.subscriptionTier,
          price: dto.price,
          currency: dto.currency,
          serviceStartDate: dto.serviceStartDate ? new Date(dto.serviceStartDate) : undefined,
          serviceEndDate: dto.serviceEndDate ? new Date(dto.serviceEndDate) : undefined,
        },
      });
      const calls = await tx.leadExpertCall.findMany({ where: { leadId, status: { in: ["REQUESTED", "CONFIRMED"] } }, select: { id: true, meetingId: true } });
      await tx.leadExpertCall.updateMany({
        where: { id: { in: calls.map(c => c.id) } },
        data: { status: "COMPLETED", outcome: "CONTRACT", completedAt: new Date(), questionnaire: lead.expertQuestionnaire ?? Prisma.JsonNull },
      });
      await tx.meeting.updateMany({ where: { id: { in: calls.flatMap(c => (c.meetingId ? [c.meetingId] : [])) } }, data: { status: "COMPLETED" } });
      await tx.leadCallback.updateMany({ where: { leadId, status: "SCHEDULED" }, data: { status: "CANCELLED", cancelledAt: new Date() } });
      await tx.notificationLog.updateMany({ where: { leadId, status: "PENDING" }, data: { status: "CANCELLED" } });
      const updated = await tx.lead.update({
        where: { id: leadId },
        data: { contractId: contract.id, ...leadStatusUpdate(lead.status, "CONTRACT_PENDING"), callbackReason: null },
      });
      await tx.leadActivity.create({
        data: { leadId, actorUserId: expertId, type: "CONTRACT_PREPARED", metadata: { contractId: contract.id, studentId: student.id, reusedAccount: users.length > 0 } },
      });
      const invitation = users.length ? null : await tx.leadStudentInvitation.create({ data: { userId: student.id, expiresAt: new Date(Date.now() + 7 * 86400_000) } });
      return { lead: updated, contract, invitation };
    });
    if (result.invitation && !result.invitation.sentAt) await this.invitations.enqueue();
    if (result.lead.assignedSalesManagerId) this.realtime.emitLeadUpdated(result.lead.assignedSalesManagerId, result.lead);
    this.realtime.emitExpertLeadUpdated(expertId, leadId);
    return {
      lead: result.lead,
      contract: {
        id: result.contract.id,
        status: result.contract.status,
        contractNumber: result.contract.contractNumber,
        studentId: result.contract.studentId,
        subscriptionTier: result.contract.subscriptionTier,
        price: result.contract.price,
        currency: result.contract.currency,
      },
      invitationRequired: !!result.invitation,
    };
  }
}
