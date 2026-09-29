import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import * as bcrypt from "bcrypt";
import { PrismaService } from "src/database/prisma.service";
import { Prisma } from "generated/prisma/client";
import type { Lead } from "generated/prisma/client";
import { PrepareLeadContractDto } from "../api/dto/sales/prepare-lead-contract.dto";
import { ConfirmManualContractDto, RecordContractSignatureDto } from "src/modules/contract/api/dto/manual-contract.dto";
import { confirmManualContract, manualContractRead } from "src/modules/contract/domain/manual-contract-confirmation";
import { commercialTerms, pastPaymentDate } from "src/modules/contract/domain/manual-contract";
import { normalizePhoneNumber } from "../domain/phone-number";
import { leadTransaction } from "../domain/lead-transaction";
import { leadStatusUpdate } from "../domain/lead-status";
import { assertContractAccess, contractActor } from "src/modules/contract/domain/contract-access";
import { lockStudentWithoutContract } from "src/modules/contract/domain/contract-creation";
import { LeadRealtimeGateway } from "../realtime/lead-realtime.gateway";
import { LeadStudentInvitationService } from "./lead-student-invitation.service";

/** Holds identity and contract terms without creating an account until manual confirmation. */
@Injectable()
export class LeadContractService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: LeadRealtimeGateway,
    private readonly invitations: LeadStudentInvitationService,
  ) {}

  async prepare(expertId: number, leadId: number, dto: PrepareLeadContractDto, replace = false) {
    const phone = normalizePhoneNumber(dto.phone);
    if (!phone || !dto.firstname.trim() || !dto.lastname.trim()) throw new BadRequestException("Student name and valid phone are required");
    if (dto.serviceStartDate && dto.serviceEndDate && new Date(dto.serviceEndDate) <= new Date(dto.serviceStartDate))
      throw new BadRequestException("Service end must follow start");
    const terms = commercialTerms(dto.price, dto.currency, dto.subscriptionTier, dto.paymentType, dto.installmentCount);
    const parent = dto.parent
      ? {
          ...dto.parent,
          firstname: dto.parent.firstname.trim(),
          lastname: dto.parent.lastname.trim(),
          middlename: dto.parent.middlename?.trim() || null,
          ...(dto.parent.phone ? { phone: normalizePhoneNumber(dto.parent.phone) } : {}),
        }
      : undefined;
    if (parent && (!parent.firstname || !parent.lastname || (dto.parent?.phone && !parent.phone))) throw new BadRequestException("Valid parent name and phone are required");
    const data = JSON.parse(
      JSON.stringify({
        ...dto,
        ...terms,
        phone,
        email: dto.email.trim().toLowerCase(),
        firstname: dto.firstname.trim(),
        lastname: dto.lastname.trim(),
        middlename: dto.middlename?.trim() || null,
        parent,
      }),
    ) as Prisma.InputJsonObject;
    const result = await leadTransaction(this.prisma, async tx => {
      const lead = await this.owned(tx, expertId, leadId);
      if (lead.contractId) {
        await assertContractAccess(tx, lead.contractId, expertId, "manage");
        if (replace) throw new ConflictException("Use contract metadata for an existing contract");
        const contract = await tx.contract.findUniqueOrThrow({ where: { id: lead.contractId }, ...manualContractRead });
        const invitation = await tx.leadStudentInvitation.findUnique({ where: { userId: contract.studentId }, select: { id: true } });
        return { lead, contract, draft: null, invitationRequired: !!invitation };
      }
      const previous = await tx.leadContractDraft.findUnique({ where: { leadId } });
      if (previous && !replace) return { lead, contract: null, draft: previous, invitationRequired: false };
      if (previous?.signedAt) throw new ConflictException("Signed terms cannot be changed");
      if (!["CALL_SCHEDULED", "OFFICE_INVITED", "RECALL", ...(previous ? ["CONTRACT_PENDING"] : [])].includes(lead.status))
        throw new ConflictException("Lead is not ready for a contract");
      if (lead.role === "parent" && !parent) throw new BadRequestException("Separate parent identity is required for a parent lead");
      if (await tx.leadExpertCall.findFirst({ where: { leadId, status: "REQUESTED" }, select: { id: true } }))
        throw new ConflictException("Confirm the consultation before preparing a contract");
      if (!(await tx.consultantProfile.findUnique({ where: { userId: expertId } }))) throw new BadRequestException("Expert profile is required");
      const draft = await tx.leadContractDraft.upsert({ where: { leadId }, create: { leadId, data }, update: { data } });
      const calls = await tx.leadExpertCall.findMany({ where: { leadId, status: { in: ["REQUESTED", "CONFIRMED"] } }, select: { id: true, meetingId: true } });
      await tx.leadExpertCall.updateMany({
        where: { id: { in: calls.map(c => c.id) } },
        data: { status: "COMPLETED", outcome: "CONTRACT", completedAt: new Date(), questionnaire: lead.expertQuestionnaire ?? Prisma.JsonNull },
      });
      await tx.meeting.updateMany({ where: { id: { in: calls.flatMap(c => (c.meetingId ? [c.meetingId] : [])) } }, data: { status: "COMPLETED" } });
      await tx.leadCallback.updateMany({ where: { leadId, status: "SCHEDULED" }, data: { status: "CANCELLED", cancelledAt: new Date() } });
      await tx.notificationLog.updateMany({ where: { leadId, status: "PENDING" }, data: { status: "CANCELLED" } });
      const updated = await tx.lead.update({ where: { id: leadId }, data: { ...leadStatusUpdate(lead.status, "CONTRACT_PENDING"), callbackReason: null } });
      await tx.leadActivity.create({ data: { leadId, actorUserId: expertId, type: previous ? "CONTRACT_DRAFT_UPDATED" : "CONTRACT_PREPARED", metadata: { manual: true } } });
      return { lead: updated, contract: null, draft, invitationRequired: false };
    });
    this.changed(result.lead);
    return result;
  }

  async recordSignature(expertId: number, leadId: number, dto: RecordContractSignatureDto) {
    const signedAt = pastPaymentDate(dto.signedAt, "signedAt");
    const result = await leadTransaction(this.prisma, async tx => {
      const lead = await this.owned(tx, expertId, leadId);
      if (lead.status !== "CONTRACT_PENDING" || lead.contractId) throw new ConflictException("Use the manual signature endpoint for existing contracts");
      const draft = await tx.leadContractDraft.findUnique({ where: { leadId } });
      if (!draft) throw new ConflictException("Prepare the contract first");
      if (draft.signedAt?.getTime() === signedAt.getTime()) return { lead, draft };
      await tx.leadActivity.create({ data: { leadId, actorUserId: expertId, type: "CONTRACT_MANUAL_SIGNATURE", metadata: { signedAt: dto.signedAt } } });
      return { lead, draft: await tx.leadContractDraft.update({ where: { leadId }, data: { signedAt } }) };
    });
    this.changed(result.lead);
    return result;
  }

  async confirm(expertId: number, leadId: number, dto: ConfirmManualContractDto) {
    // Hash outside the retryable database transaction.
    const password = await bcrypt.hash(randomBytes(32).toString("base64url"), 12);
    const result = await leadTransaction(this.prisma, async tx => {
      const lead = await this.owned(tx, expertId, leadId);
      let contractId = lead.contractId;
      let invitationRequired = false;
      let signedAt = dto.signedAt;
      if (!contractId) {
        if (lead.status !== "CONTRACT_PENDING") throw new ConflictException("Lead is not awaiting signing");
        const draft = await tx.leadContractDraft.findUnique({ where: { leadId } });
        if (!draft) throw new ConflictException("Prepare the contract first");
        signedAt = signedAt ?? draft.signedAt?.toISOString();
        if (!signedAt) throw new BadRequestException("Confirm the manual signature first");
        const terms = draft.data as unknown as PrepareLeadContractDto;
        const validatedTerms = commercialTerms(terms.price, terms.currency, terms.subscriptionTier, terms.paymentType, terms.installmentCount);
        const expert = await tx.consultantProfile.findUniqueOrThrow({ where: { userId: expertId } });
        const { student, reused } = await this.createStudent(tx, lead, { ...terms, existingStudentId: dto.existingStudentId ?? terms.existingStudentId }, expert.id, password);
        const fullName = (person: { firstname: string; lastname: string; middlename?: string | null }) =>
          [person.lastname, person.firstname, person.middlename].filter(Boolean).join(" ");
        await lockStudentWithoutContract(tx, student.id);
        const contract = await tx.contract.create({
          data: {
            studentId: student.id,
            contractNumber: `OXUS-${new Date().getFullYear()}-CRM-${String(leadId).padStart(6, "0")}`,
            status: "PENDING_EXPERT",
            subscriptionTier: terms.subscriptionTier,
            price: terms.price,
            currency: terms.currency,
            ...validatedTerms,
            partyDetails: draft.data as Prisma.InputJsonObject,
            studentName: fullName(terms),
            clientFullName: fullName(terms.parent ?? terms),
            clientPhone: terms.parent?.phone ?? (terms.parent ? lead.phoneNumber : terms.phone),
            serviceStartDate: terms.serviceStartDate ? new Date(terms.serviceStartDate) : undefined,
            serviceEndDate: terms.serviceEndDate ? new Date(terms.serviceEndDate) : undefined,
          },
        });
        contractId = contract.id;
        await tx.lead.update({ where: { id: leadId }, data: { contractId } });
        if (!reused) {
          await tx.leadStudentInvitation.create({ data: { userId: student.id, expiresAt: new Date(Date.now() + 7 * 86400_000) } });
          invitationRequired = true;
        }
        await tx.leadContractDraft.update({ where: { leadId }, data: { signedAt: pastPaymentDate(signedAt, "signedAt") } });
      }
      const contract = await confirmManualContract(tx, contractId, expertId, { ...dto, signedAt });
      if (!invitationRequired) invitationRequired = !!(await tx.leadStudentInvitation.findUnique({ where: { userId: contract.studentId } }));
      return { lead: await tx.lead.findUniqueOrThrow({ where: { id: leadId } }), contract, invitationRequired };
    });
    if (result.invitationRequired) await this.invitations.enqueue();
    this.changed(result.lead);
    return result;
  }

  private async owned(tx: Prisma.TransactionClient, expertId: number, id: number) {
    await contractActor(tx, expertId, "manage");
    const lead = await tx.lead.findFirst({ where: { id, assignedExpertUserId: expertId, deletedAt: null } });
    if (!lead) throw new NotFoundException("Lead not found");
    return lead;
  }

  private changed(lead: Lead) {
    if (lead.assignedSalesManagerId) this.realtime.emitLeadUpdated(lead.assignedSalesManagerId, lead);
    if (lead.assignedExpertUserId) this.realtime.emitExpertLeadUpdated(lead.assignedExpertUserId, lead.id);
  }

  private async createStudent(tx: Prisma.TransactionClient, lead: Lead, dto: PrepareLeadContractDto, expertId: number, password: string) {
    const leadId = lead.id;
    const phoneNumber = normalizePhoneNumber(dto.phone)!;
    const email = dto.email.trim().toLowerCase();
    const middlename = dto.middlename?.trim() || null;
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
      if (student.portrait?.consultantProfileId && student.portrait.consultantProfileId !== expertId)
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
    return { student, reused: users.length > 0 };
  }
}
