import { createHash, randomBytes, randomUUID } from "node:crypto";
import * as bcrypt from "bcrypt";
import { Prisma } from "generated/prisma/client";
import { PrismaService } from "src/database/prisma.service";
import { lockExpertBookings } from "src/common/database/expert-booking-lock";
import { getLocalDateParts, rangesOverlap } from "src/common/helpers/timezone";
import { splitLeadSlots } from "src/modules/lead/domain/lead-booking";
import { LEAD_PERMISSION, LEAD_SOURCE } from "src/modules/lead/domain/lead.constants";
import { CalculatorQuestionnaireService } from "src/modules/lead/service/calculator-questionnaire.service";
import { LeadExpertCallService } from "src/modules/lead/service/lead-expert-call.service";
import { LeadRealtimeGateway } from "src/modules/lead/realtime/lead-realtime.gateway";
import { TIER_SLOTS } from "src/modules/studentportrait/domain/contract-benefits";
import {
  DEMO_EXPERT_EMAIL,
  DEMO_SALES_EMAIL,
  DEMO_TIMEZONE,
  demoBatchKey,
  demoScenarios,
  demoTime,
  normalizeDemoOptions,
  type DemoOptions,
  type DemoInput,
  type DemoScenario,
} from "./sales-expert-demo.plan";

const DAY = 86_400_000;
const MINUTE = 60_000;
type Slot = { startTime: Date; endTime: Date };
type Schedule = { dayOfWeek: number; startMinute: number; endMinute: number };
type DemoEntry = DemoScenario & { leadId?: number; status?: string; slot?: Slot; history?: Slot; callbackAt?: Date };
type DemoContext = {
  batch: string;
  managerId: number;
  expertId: number;
  profileId: number;
  studentRoleId: number;
  sourceIds: Record<string, number>;
  schedulesToAdd: Schedule[];
  entries: DemoEntry[];
};

function json(value: unknown): Prisma.InputJsonObject {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonObject;
}

function contacts(batch: string, code: string) {
  const hash = createHash("sha256").update(`${batch}:${code}`).digest("hex").slice(0, 12);
  return {
    email: `demo-${hash}-${code.toLowerCase()}@example.invalid`,
    phoneNumber: `+999${String(parseInt(hash, 16)).padStart(15, "0").slice(0, 12)}`,
  };
}

/** Read-only planning is also repeated under the same booking lock used by the application. */
async function prepare(tx: Prisma.TransactionClient, options: DemoOptions, now: Date): Promise<DemoContext> {
  const { startDate, salesEmail, expertEmail } = options;
  const users = await tx.user.findMany({
    where: { OR: [{ email: { equals: salesEmail, mode: "insensitive" } }, { email: { equals: expertEmail, mode: "insensitive" } }], deletedAt: null },
    include: { role: { include: { permissions: true } }, consultantProfile: true, expertSchedules: true },
  });
  const managers = users.filter(user => user.email.toLowerCase() === salesEmail);
  const experts = users.filter(user => user.email.toLowerCase() === expertEmail);
  if (managers.length > 1 || experts.length > 1) throw new Error("Multiple accounts match an email ignoring case; no data changed");
  const manager = managers[0];
  const expert = experts[0];
  if (!manager || manager.role.code !== "SALES_MANAGER" || manager.role.deletedAt) throw new Error(`Active SALES_MANAGER required: ${salesEmail}`);
  if (!expert || expert.role.code !== "EXPERT" || expert.role.deletedAt || !expert.consultantProfile?.isActive) throw new Error(`Active EXPERT profile required: ${expertEmail}`);
  if (expert.timezone !== DEMO_TIMEZONE) throw new Error(`Expert timezone must be ${DEMO_TIMEZONE}; existing timezone was not changed`);
  for (const [user, required] of [
    [manager, Object.values(LEAD_PERMISSION).filter(code => code !== LEAD_PERMISSION.RESPOND_EXPERT_CALL)],
    [expert, [LEAD_PERMISSION.RESPOND_EXPERT_CALL]],
  ] as const) {
    const granted = new Set(user.role.permissions.filter(permission => !permission.deletedAt).map(permission => permission.code));
    if (required.some(code => !granted.has(code))) throw new Error(`Missing CRM permissions for ${user.email}; run the normal role setup first`);
  }
  const studentRole = await tx.role.findFirst({ where: { code: "STUDENT", deletedAt: null } });
  if (!studentRole) throw new Error("Active STUDENT role required");
  const sources = await tx.leadSource.findMany({ where: { code: { in: [LEAD_SOURCE.OFFICE_MANUAL, LEAD_SOURCE.LANDING_CALCULATOR] }, isActive: true } });
  if (sources.length !== 2) throw new Error("Active office-manual and landing-calculator sources required");

  const scenarios = demoScenarios(startDate);
  const batch = demoBatchKey(startDate, { managerId: manager.id, expertId: expert.id });
  // Recognize the original fixed-account command's markers without resetting progress.
  const legacyBatch = salesEmail === DEMO_SALES_EMAIL && expertEmail === DEMO_EXPERT_EMAIL ? demoBatchKey(startDate) : undefined;
  const markers = (code: string) => [`${batch}:${code}`, ...(legacyBatch ? [`${legacyBatch}:${code}`] : [])];
  const saved = await tx.leadSubmission.findMany({
    where: { externalSubmissionId: { in: scenarios.flatMap(scenario => markers(scenario.code)) } },
    select: { externalSubmissionId: true, lead: { select: { id: true, status: true } } },
  });
  if (new Set(saved.map(row => row.externalSubmissionId)).size !== saved.length) throw new Error("Duplicate demo markers found; no data changed");
  const entries: DemoEntry[] = scenarios.map(scenario => {
    const matches = saved.filter(row => markers(scenario.code).includes(row.externalSubmissionId!));
    if (matches.length > 1) throw new Error("Both legacy and current demo markers exist for a scenario; no data changed");
    const existing = matches[0];
    return { ...scenario, leadId: existing?.lead.id, status: existing?.lead.status };
  });
  const missing = entries.filter(entry => !entry.leadId);
  const schedules = [...expert.expertSchedules];
  const schedulesToAdd: Schedule[] = [];
  for (const day of new Set(missing.filter(entry => entry.kind === "consultation").map(entry => entry.day))) {
    const dayOfWeek = getLocalDateParts(demoTime(day, 12 * 60), DEMO_TIMEZONE).dayOfWeek;
    if (!schedules.some(schedule => schedule.dayOfWeek === dayOfWeek)) schedulesToAdd.push({ dayOfWeek, startMinute: 9 * 60, endMinute: 17 * 60 + 30 });
  }
  const configured = [...schedules, ...schedulesToAdd];
  const earliestHistory = new Date(Math.min(demoTime(startDate, 0).getTime(), now.getTime()) - 30 * DAY);
  const rangeEnd = new Date(demoTime(scenarios.at(-1)!.day, 0).getTime() + DAY);
  const calls = await tx.leadExpertCall.findMany({
    where: { expertUserId: expert.id, startTime: { lt: rangeEnd }, endTime: { gt: earliestHistory } },
    select: { startTime: true, endTime: true },
  });
  const consultations = await tx.consultation.findMany({
    where: { consultantProfileId: expert.consultantProfile.id, status: { not: "CANCELLED" }, startTime: { lt: rangeEnd }, endTime: { gt: earliestHistory } },
    select: { startTime: true, endTime: true },
  });
  const occupied: Slot[] = [...calls, ...consultations];
  const reserve = (slots: Slot[], label: string) => {
    const slot = slots.find(candidate => !occupied.some(busy => rangesOverlap(candidate.startTime, candidate.endTime, busy.startTime, busy.endTime)));
    if (!slot) throw new Error(`Not enough free slots for ${label}; existing bookings and schedules were not overwritten`);
    occupied.push(slot);
    return slot;
  };

  // Historical reservations were made in advance. Past appointments get outcomes,
  // while future appointments remain actionable without changing booking validation.
  for (const entry of missing.filter(entry => entry.kind === "consultation")) {
    const day = getLocalDateParts(demoTime(entry.day, 12 * 60), DEMO_TIMEZONE);
    const slots = configured
      .filter(schedule => schedule.dayOfWeek === day.dayOfWeek)
      .flatMap(schedule => splitLeadSlots(day, schedule.startMinute, schedule.endMinute, DEMO_TIMEZONE));
    const upcoming = slots.filter(slot => slot.startTime.getTime() >= now.getTime() + 10 * MINUTE).sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
    const past = slots.filter(slot => slot.endTime <= now).sort((a, b) => b.startTime.getTime() - a.startTime.getTime());
    entry.slot = reserve([...upcoming, ...past], `${entry.code} on ${entry.day}`);
  }

  const historySlots: Slot[] = [];
  const historyEnd = new Date(Math.min(demoTime(startDate, 0).getTime(), now.getTime()));
  for (let offset = 1; offset <= 30; offset++) {
    const day = getLocalDateParts(new Date(historyEnd.getTime() - offset * DAY), DEMO_TIMEZONE);
    historySlots.push(...splitLeadSlots(day, 9 * 60, 17 * 60 + 30, DEMO_TIMEZONE));
  }
  for (const entry of missing) {
    if ((entry.kind === "callback" && entry.position !== 3) || entry.kind === "contract" || entry.kind === "rejected")
      entry.history = reserve(historySlots, `${entry.code} history`);
    if (entry.kind === "callback") entry.callbackAt = demoTime(entry.day, [10 * 60 + 15, 14 * 60 + 15, 16 * 60 + 15][entry.position - 3]);
    entry.status =
      entry.kind === "new"
        ? "NEW"
        : entry.kind === "callback"
          ? "RECALL"
          : entry.kind === "rejected"
            ? "REJECTED"
            : entry.kind === "contract"
              ? entry.dayIndex === 2
                ? "CONVERTED"
                : "CONTRACT_PENDING"
              : entry.slot!.endTime <= now
                ? "RECALL"
                : entry.position < 8
                  ? "CALL_SCHEDULED"
                  : "OFFICE_INVITED";
  }
  const identities = missing.flatMap(entry => [contacts(batch, entry.code), ...(entry.kind === "contract" ? [contacts(batch, `${entry.code}-student`)] : [])]);
  if (identities.length) {
    const where = { OR: [{ email: { in: identities.map(identity => identity.email) } }, { phoneNumber: { in: identities.map(identity => identity.phoneNumber) } }] };
    if ((await tx.lead.count({ where })) || (await tx.user.count({ where }))) throw new Error("Demo contacts already exist without their scenario markers; no data changed");
  }
  return {
    batch,
    managerId: manager.id,
    expertId: expert.id,
    profileId: expert.consultantProfile.id,
    studentRoleId: studentRole.id,
    sourceIds: Object.fromEntries(sources.map(source => [source.code, source.id])),
    schedulesToAdd,
    entries,
  };
}

/** Inserts a complete fixture snapshot without starting the app, sending mail or SMS. */
async function insertScenario(tx: Prisma.TransactionClient, ctx: DemoContext, entry: DemoEntry, batch: string, now: Date, password: string, officeAddress: string) {
  const { managerId, expertId, profileId } = ctx;
  const calculator = new CalculatorQuestionnaireService();
  const questions = calculator.definition().questionnaires[entry.role];
  const answers = questions.slice(0, entry.position === 1 ? 3 : questions.length).map((question, index) => {
    const options = question.options.filter(option => !("allowsFreeText" in option && option.allowsFreeText));
    const option = question.id === "city" ? question.options.find(option => option.id === "almaty")! : options[(entry.dayIndex + index) % options.length];
    return { questionId: question.id, optionId: option.id };
  });
  const questionnaire = calculator.calculate({ role: entry.role, locale: entry.locale, answers });
  const identity = contacts(batch, entry.code);
  const sourceCode = entry.position % 3 === 0 ? LEAD_SOURCE.LANDING_CALCULATOR : LEAD_SOURCE.OFFICE_MANUAL;
  const sourceId = ctx.sourceIds[sourceCode];
  const bookedAt = new Date(Math.min(now.getTime() - 60 * MINUTE, (entry.history ?? entry.slot)?.startTime.getTime() ?? now.getTime()) - DAY);
  const createdAt = new Date(bookedAt.getTime() - 60 * MINUTE);
  const displayName = `DEMO-${entry.code} ${entry.name}`;
  const assigned = entry.position !== 0;
  const hasExpert = !!entry.history || entry.kind === "consultation";
  const expertQuestionnaire = {
    version: "expert-v2",
    schoolType: "STATE",
    schoolName: `Школа №${25 + entry.position}`,
    grade: "11",
    birthDate: "2008-03-15",
    passport: "YES",
    favoriteSubjects: ["Математика", "Английский"],
    languages: ["Английский"],
    foundationYear: entry.dayIndex === 1,
    nonEnglishStudy: false,
    studyLanguages: [],
    specialConditions: false,
    additionalInformation: entry.description,
  };
  const lead = await tx.lead.create({
    data: {
      displayName,
      ...identity,
      role: entry.role,
      preferredLanguage: entry.locale,
      originSourceId: sourceId,
      createdByUserId: sourceCode === LEAD_SOURCE.OFFICE_MANUAL ? managerId : null,
      assignedSalesManagerId: assigned ? managerId : null,
      acceptedAt: assigned ? new Date(createdAt.getTime() + 15 * MINUTE) : null,
      assignedExpertUserId: hasExpert ? expertId : null,
      expertQuestionnaire: hasExpert ? expertQuestionnaire : undefined,
      createdAt,
      updatedAt: bookedAt,
    },
  });
  const activity = (type: string, actorUserId: number | null, at: Date, metadata: Prisma.InputJsonObject = {}) =>
    tx.leadActivity.create({ data: { leadId: lead.id, type, actorUserId, createdAt: at, metadata: { ...metadata, demoBatch: batch, scenario: entry.code } } });
  const notify = (userId: number, type: string, content: string, at: Date, metadata: Prisma.InputJsonObject, pending = false) =>
    tx.notificationLog.create({
      data: {
        leadId: lead.id,
        userId,
        type,
        channel: "IN_APP",
        status: pending ? "PENDING" : "SENT",
        content,
        metadata,
        scheduledFor: at,
        sentAt: pending ? null : at,
        createdAt: bookedAt,
      },
    });
  const raw = {
    name: displayName,
    phone: identity.phoneNumber,
    email: identity.email,
    role: entry.role,
    locale: entry.locale,
    quizVersion: questionnaire.version,
    answers: sourceCode === LEAD_SOURCE.OFFICE_MANUAL ? answers : questionnaire.answers,
    ...questionnaire.metrics,
    submittedAt: createdAt.toISOString(),
    submissionId: `${batch}:${entry.code}`,
    demo: { batch, scenario: entry.code, day: entry.day, description: entry.description },
  };
  await tx.leadSubmission.create({
    data: {
      leadId: lead.id,
      sourceId,
      externalSubmissionId: `${batch}:${entry.code}`,
      schemaVersion: sourceCode === LEAD_SOURCE.OFFICE_MANUAL ? "office-manual-v2" : "landing-calculator-v1",
      calculatorVersion: questionnaire.version,
      rawPayload: json(raw),
      normalizedPayload: json({ displayName, ...identity, role: entry.role, preferredLanguage: entry.locale, questionnaire }),
      metrics: json(questionnaire.metrics),
      submittedAt: createdAt,
      receivedAt: createdAt,
    },
  });
  await activity("LEAD_CREATED", sourceCode === LEAD_SOURCE.OFFICE_MANUAL ? managerId : null, createdAt, { sourceCode });
  if (assigned) await activity("LEAD_ACCEPTED", managerId, lead.acceptedAt!);

  const createCall = async (slot: Slot, format: "ONLINE" | "OFFICE", status: "REQUESTED" | "CONFIRMED" | "COMPLETED" | "DECLINED", outcome?: string) => {
    const booking = {
      expertUserId: expertId,
      startTime: slot.startTime.toISOString(),
      endTime: slot.endTime.toISOString(),
      format,
      comment: entry.description,
      ...(format === "OFFICE" ? { officeCode: "almaty", officeAddress } : {}),
    };
    const roomName = randomUUID();
    const invitation = await tx.leadMeetingInvitation.create({
      data: {
        leadId: lead.id,
        salesManagerId: managerId,
        roomName,
        booking,
        createdAt: bookedAt,
        expiresAt: new Date(Math.min(bookedAt.getTime() + DAY, slot.startTime.getTime())),
      },
    });
    const confirmed = status === "CONFIRMED" || (status === "COMPLETED" && outcome !== "NO_SHOW");
    const respondedAt = new Date(bookedAt.getTime() + 5 * MINUTE);
    const meeting =
      format === "ONLINE" && confirmed
        ? await tx.meeting.create({ data: { roomName, expertId: profileId, ...slot, status: status === "COMPLETED" ? "COMPLETED" : "SCHEDULED", createdAt: respondedAt } })
        : null;
    const finishedAt = status === "COMPLETED" ? slot.endTime : null;
    const call = await tx.leadExpertCall.create({
      data: {
        leadId: lead.id,
        salesManagerId: managerId,
        expertUserId: expertId,
        ...slot,
        format,
        status,
        invitationId: invitation.id,
        meetingId: meeting?.id,
        officeCode: format === "OFFICE" ? "almaty" : null,
        officeAddress: format === "OFFICE" ? officeAddress : null,
        comment: entry.description,
        responseComment: status === "DECLINED" ? "Прошу согласовать другое время" : null,
        respondedAt: confirmed || status === "DECLINED" ? respondedAt : null,
        completedAt: finishedAt,
        outcome,
        questionnaire: status === "COMPLETED" ? expertQuestionnaire : undefined,
        createdAt: bookedAt,
        updatedAt: finishedAt ?? respondedAt,
      },
    });
    await activity("EXPERT_CALL_REQUESTED", managerId, bookedAt, {
      callId: call.id,
      expertUserId: expertId,
      startTime: slot.startTime.toISOString(),
      endTime: slot.endTime.toISOString(),
      format,
    });
    await notify(expertId, "LEAD_EXPERT_CALL_REQUEST", `${displayName}: ${entry.description}`, bookedAt, { callId: call.id });
    if (confirmed) await activity("EXPERT_CALL_CONFIRMED", expertId, respondedAt, { callId: call.id, meetingId: meeting?.id ?? null });
    if (status === "DECLINED") await activity("EXPERT_CALL_DECLINED", expertId, respondedAt, { callId: call.id, comment: "Прошу согласовать другое время" });
    if (finishedAt && outcome !== "CONTRACT")
      await activity("EXPERT_FOLLOW_UP", expertId, finishedAt, { callId: call.id, reason: outcome ?? "FOLLOW_UP", comment: entry.description });
    if (confirmed || status === "DECLINED")
      await notify(managerId, "LEAD_EXPERT_CALL_RESPONSE", `${displayName}: ${confirmed ? "Встреча подтверждена" : "Запрос отклонён"}`, respondedAt, { callId: call.id });
    if (finishedAt && outcome !== "CONTRACT")
      await notify(managerId, "LEAD_FOLLOW_UP", `${displayName}: ${entry.description}`, finishedAt, { callId: call.id, reason: outcome ?? "FOLLOW_UP" });
    return call;
  };

  if (entry.history) {
    const declined = entry.kind === "callback" && entry.position === 5 && entry.dayIndex === 2;
    const outcome = entry.kind === "contract" ? "CONTRACT" : entry.position === 4 ? "RESCHEDULED" : entry.position === 5 && entry.dayIndex === 1 ? "NO_SHOW" : "FOLLOW_UP";
    await createCall(entry.history, "ONLINE", declined ? "DECLINED" : "COMPLETED", declined ? undefined : outcome);
  }
  let state: Prisma.LeadUpdateInput = {};
  if (entry.kind === "callback") {
    const reason = (["NO_ANSWER", "RESCHEDULED", "FOLLOW_UP"] as const)[entry.position - 3];
    const previousAt = new Date((entry.history?.endTime ?? bookedAt).getTime() + 15 * MINUTE);
    const previousCreatedAt = entry.history ? new Date(entry.history.endTime.getTime() + MINUTE) : bookedAt;
    const previous = await tx.leadCallback.create({
      data: {
        leadId: lead.id,
        salesManagerId: managerId,
        scheduledFor: previousAt,
        status: "CANCELLED",
        reason,
        comment: "Предыдущая попытка; согласовано новое время",
        cancelledAt: new Date(previousAt.getTime() + MINUTE),
        createdAt: previousCreatedAt,
        updatedAt: new Date(previousAt.getTime() + MINUTE),
      },
    });
    await activity("CALLBACK_SCHEDULED", managerId, previousCreatedAt, { callbackId: previous.id, scheduledFor: previousAt.toISOString() });
    await activity("CALLBACK_UPDATED", managerId, new Date(previousAt.getTime() + MINUTE), { callbackId: previous.id, status: "CANCELLED" });
    const scheduledAt = new Date(previousAt.getTime() + 2 * MINUTE);
    const callback = await tx.leadCallback.create({
      data: { leadId: lead.id, salesManagerId: managerId, scheduledFor: entry.callbackAt!, reason, comment: entry.description, createdAt: scheduledAt, updatedAt: scheduledAt },
    });
    await activity("CALLBACK_SCHEDULED", managerId, scheduledAt, { callbackId: callback.id, scheduledFor: entry.callbackAt!.toISOString() });
    await notify(managerId, "LEAD_CALLBACK_REMINDER", `Пора перезвонить: ${displayName}`, entry.callbackAt!, { callbackId: callback.id }, true);
    state = { status: "RECALL", callbackReason: reason };
  } else if (entry.kind === "consultation") {
    const format = entry.position < 8 ? "ONLINE" : "OFFICE";
    const past = entry.slot!.endTime <= now;
    const status = past ? "COMPLETED" : entry.position % 2 === 0 ? "REQUESTED" : "CONFIRMED";
    await createCall(entry.slot!, format, status, past ? "FOLLOW_UP" : undefined);
    state = { status: past ? "RECALL" : format === "ONLINE" ? "CALL_SCHEDULED" : "OFFICE_INVITED", callbackReason: past ? "FOLLOW_UP" : null };
  } else if (entry.kind === "rejected") {
    const rejectedAt = new Date(entry.history!.endTime.getTime() + 15 * MINUTE);
    const reason = ["Семья выбрала другой бюджет", "Решили поступать в следующем году", "Выбрали обучение в Казахстане"][entry.dayIndex];
    state = { status: "REJECTED", rejectedAt, rejectionReason: reason };
    await activity("LEAD_REJECTED", managerId, rejectedAt, { reason });
  } else if (entry.kind === "contract") {
    const studentIdentity = contacts(batch, `${entry.code}-student`);
    const signed = entry.dayIndex === 2;
    const preparedAt = new Date(entry.history!.endTime.getTime() + MINUTE);
    const expertSignedAt = entry.dayIndex > 0 ? new Date(preparedAt.getTime() + 5 * MINUTE) : null;
    const studentSignedAt = signed ? new Date(preparedAt.getTime() + 10 * MINUTE) : null;
    const student = await tx.user.create({
      data: {
        firstname: entry.role === "parent" ? "DEMO Ученик" : `DEMO ${entry.name.split(" ")[0]}`,
        lastname: entry.name.split(" ").slice(1).join(" "),
        ...studentIdentity,
        password,
        roleId: ctx.studentRoleId,
        createdAt,
        timezone: DEMO_TIMEZONE,
      },
    });
    await tx.studentPortrait.create({
      data: {
        userId: student.id,
        birthDate: new Date("2008-03-15T00:00:00Z"),
        meta: { leadId: lead.id, demoBatch: batch, expertQuestionnaire },
        subscription: signed ? "EXPERT_MENTORSHIP" : "FREE",
        consultantProfileId: signed ? profileId : null,
      },
    });
    const contract = await tx.contract.create({
      data: {
        studentId: student.id,
        contractNumber: `DEMO-${createHash("sha256").update(batch).digest("hex").slice(0, 16)}-${entry.code}`,
        subscriptionTier: "EXPERT_MENTORSHIP",
        price: 250000,
        currency: "KZT",
        status: signed ? "SIGNED" : entry.dayIndex === 1 ? "PENDING_STUDENT" : "PENDING_EXPERT",
        signedByUserId: expertSignedAt ? expertId : null,
        expertSignedAt,
        studentSignedAt,
        serviceStartDate: demoTime(entry.day, 0),
        serviceEndDate: new Date(demoTime(entry.day, 0).getTime() + 180 * DAY),
        clientFullName: signed ? displayName : null,
        studentName: signed ? `${student.firstname} ${student.lastname}` : null,
        clientPhone: signed ? identity.phoneNumber : null,
        clientAddress: signed ? "DEMO, г. Алматы, тестовый адрес" : null,
        clientIin: signed ? "000000000000" : null,
        createdAt: preparedAt,
        updatedAt: studentSignedAt ?? expertSignedAt ?? preparedAt,
      },
    });
    await activity("CONTRACT_PREPARED", expertId, preparedAt, { contractId: contract.id, studentId: student.id, reusedAccount: true, synthetic: true });
    if (signed) {
      await tx.studentPackage.create({ data: { studentId: student.id, expertId: profileId, totalSlots: TIER_SLOTS.EXPERT_MENTORSHIP!, createdAt: studentSignedAt! } });
      await activity("LEAD_CONVERTED", student.id, studentSignedAt!, { contractId: contract.id, studentId: student.id, synthetic: true });
    }
    state = { status: signed ? "CONVERTED" : "CONTRACT_PENDING", contract: { connect: { id: contract.id } }, convertedAt: studentSignedAt };
  }
  if (hasExpert && (entry.history || entry.position % 2 === 1)) state.expertStartedAt = new Date(bookedAt.getTime() + 5 * MINUTE);
  const updated = await tx.lead.update({ where: { id: lead.id }, data: state });
  return { ...entry, leadId: lead.id, status: updated.status };
}

export async function seedSalesExpertDemo(prisma: PrismaService, input: DemoInput, now = new Date()) {
  if (process.env.STAGING !== "true") throw new Error("Demo seed requires STAGING=true");
  const options = normalizeDemoOptions(input, now);
  const batch = demoBatchKey(options.startDate);
  // The regular application container can load this command without dev dependencies.
  const officeAddress = new LeadExpertCallService(prisma, {} as LeadRealtimeGateway).offices().find(office => office.code === "almaty")!.address;
  const password = options.apply ? await bcrypt.hash(randomBytes(32).toString("base64url"), 12) : "";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await prisma.$transaction(
        async tx => {
          if (options.apply) {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(1331186771, hashtext(${batch}))`;
            const expert = await tx.user.findFirst({ where: { email: { equals: options.expertEmail, mode: "insensitive" }, deletedAt: null }, select: { id: true } });
            if (expert) await lockExpertBookings(tx, expert.id);
          } else {
            await tx.$executeRaw`SET TRANSACTION READ ONLY`;
          }
          const ctx = await prepare(tx, options, now);
          const existing = ctx.entries.filter(entry => entry.leadId).length;
          if (options.apply) {
            for (const schedule of ctx.schedulesToAdd) await tx.expertSchedule.create({ data: { expertId: ctx.expertId, ...schedule } });
            for (let i = 0; i < ctx.entries.length; i++) {
              if (!ctx.entries[i].leadId) ctx.entries[i] = await insertScenario(tx, ctx, ctx.entries[i], ctx.batch, now, password, officeAddress);
            }
          }
          return {
            batch: ctx.batch,
            startDate: options.startDate,
            endDate: ctx.entries.at(-1)!.day,
            accounts: { sales: { id: ctx.managerId, email: options.salesEmail }, expert: { id: ctx.expertId, email: options.expertEmail } },
            applied: options.apply,
            total: ctx.entries.length,
            created: options.apply ? ctx.entries.length - existing : 0,
            toCreate: options.apply ? 0 : ctx.entries.length - existing,
            preserved: existing,
            schedulesToAdd: ctx.schedulesToAdd,
            entries: ctx.entries,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 60_000, maxWait: 10_000 },
      );
    } catch (error) {
      if (attempt === 2 || !["P2034", "P2002"].includes((error as { code?: string }).code ?? "")) throw error;
    }
  }
  throw new Error("Demo seed transaction failed");
}
