/** Run only against a disposable migrated database. No external mail or JaaS calls. */
import "reflect-metadata";
import assert from "node:assert/strict";
import { PrismaService } from "../src/database/prisma.service";
import { LeadRealtimeGateway } from "../src/modules/lead/realtime/lead-realtime.gateway";
import { LeadIngestionRepository } from "../src/modules/lead/repository/lead-ingestion.repository";
import { SalesLeadRepository } from "../src/modules/lead/repository/sales-lead.repository";
import { ManualLeadV2Service } from "../src/modules/lead/service/manual-lead-v2.service";
import { CalculatorQuestionnaireService } from "../src/modules/lead/service/calculator-questionnaire.service";
import { LeadExpertCallService } from "../src/modules/lead/service/lead-expert-call.service";
import { LeadAvailabilityService } from "../src/modules/lead/service/lead-availability.service";
import { ExpertLeadService } from "../src/modules/lead/service/expert-lead.service";
import { LeadContractService } from "../src/modules/lead/service/lead-contract.service";
import { LeadGuestMeetingService } from "../src/modules/lead/service/lead-guest-meeting.service";
import { LeadStudentInvitationService } from "../src/modules/lead/service/lead-student-invitation.service";
import { ContractRepository } from "../src/modules/contract/repository/contract.repository";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { CreateManualLeadV2Dto } from "../src/modules/lead/api/dto/sales/sales-v2.dto";
import { getLocalDateParts } from "../src/common/helpers/timezone";

const url = new URL(process.env.DATABASE_URL ?? "");
if (!["127.0.0.1", "localhost"].includes(url.hostname) || !url.pathname.endsWith("_test")) throw new Error("Use a disposable local *_test database");
const prisma = new PrismaService();
const events: { name: string; args: unknown[] }[] = [];
const realtime = new Proxy(
  {},
  {
    get:
      (_, name) =>
      (...args: unknown[]) =>
        events.push({ name: String(name), args }),
  },
) as LeadRealtimeGateway;
const calculator = new CalculatorQuestionnaireService();
const manual = new ManualLeadV2Service(prisma, new LeadIngestionRepository(prisma), calculator, realtime);
const sales = new SalesLeadRepository(prisma);
const calls = new LeadExpertCallService(prisma, realtime);
const availability = new LeadAvailabilityService(prisma);
const experts = new ExpertLeadService(prisma, realtime);
const jwt = new JwtService();
const mail: string[] = [];
const invitationService = new LeadStudentInvitationService(
  prisma,
  jwt,
  new ConfigService({ JWT_SECRET: "smoke-test-secret", FRONTEND_URL: "https://example.test" }),
  {
    sendMail: async (_to: string, _subject: string, text: string) => {
      mail.push(text);
    },
  } as any,
  { add: async () => {} } as any,
);
const contracts = new LeadContractService(prisma, realtime, invitationService);
const contractRepo = Object.assign(new ContractRepository(), { prisma }) as ContractRepository;
const guests = new LeadGuestMeetingService(prisma, { signLeadRoomToken: (roomName: string, user: unknown, moderator: boolean) => ({ roomName, user, moderator }) } as any);
let checks = 0;
function checked(message: string) {
  checks++;
  console.log(`PASS ${message}`);
}

async function main() {
  await prisma.$connect();
  const run = Date.now().toString();
  for (const code of ["STUDENT", "EXPERT", "SALES_MANAGER"]) await prisma.role.upsert({ where: { code }, create: { code, name: code }, update: {} });
  const createUser = async (code: string, name: string) =>
    prisma.user.create({ data: { firstname: name, lastname: "Smoke", email: `${run}-${name}@example.test`, password: "unused-test-hash", role: { connect: { code } } } });
  const manager = await createUser("SALES_MANAGER", "sales");
  const otherManager = await createUser("SALES_MANAGER", "other-sales");
  const expert = await createUser("EXPERT", "expert");
  const otherExpert = await createUser("EXPERT", "other-expert");
  const profile = await prisma.consultantProfile.create({ data: { userId: expert.id, isActive: true } });
  const otherProfile = await prisma.consultantProfile.create({ data: { userId: otherExpert.id, isActive: true } });
  const start = new Date(Date.now() + 3 * 86400_000);
  start.setUTCHours(4, 0, 0, 0);
  await prisma.expertSchedule.create({ data: { expertId: expert.id, dayOfWeek: getLocalDateParts(start, "Asia/Almaty").dayOfWeek, startMinute: 9 * 60, endMinute: 17 * 60 + 30 } });
  const draft = { name: "Parent Smoke", phone: "+77770000001", email: `${run}-parent@example.test`, role: "parent" as const, locale: "ru" as const, answers: [] };
  const invalid = plainToInstance(CreateManualLeadV2Dto, { ...draft, email: undefined });
  assert((await validate(invalid)).some(e => e.property === "email"));
  assert.equal((await validate(plainToInstance(CreateManualLeadV2Dto, draft))).length, 0);
  const { lead } = await manual.create(manager.id, draft);
  assert.equal(lead.status, "NEW");
  assert.equal(lead.assignedSalesManagerId, null);
  checked("manual parent lead: mandatory email, partial questionnaire, separate acceptance");
  const claims = await Promise.all([sales.accept(lead.id, manager.id), sales.accept(lead.id, otherManager.id)]);
  assert.equal(claims.filter(Boolean).length, 1);
  const owner = claims[0] ? manager : otherManager;
  await assert.rejects(manual.saveAnswers(claims[0] ? otherManager.id : manager.id, lead.id, { role: "parent", locale: "ru", answers: [] }));
  await manual.saveAnswers(owner.id, lead.id, { role: "parent", locale: "kk", answers: [{ questionId: "city", optionId: "almaty" }] });
  assert.equal(await prisma.leadSubmission.count({ where: { leadId: lead.id } }), 2);
  checked("only one Sales can accept; questionnaire snapshots and ownership preserved");
  const booking = {
    expertUserId: expert.id,
    startTime: start.toISOString(),
    endTime: new Date(start.getTime() + 30 * 60_000).toISOString(),
    format: "ONLINE" as const,
    comment: "Internal expert context",
  };
  const preview = await calls.preview(owner.id, lead.id, booking);
  assert(preview.guestUrl?.endsWith(preview.invitationId));
  assert(!preview.copyText.includes(booking.comment));
  assert.equal(await prisma.leadExpertCall.count({ where: { leadId: lead.id } }), 0);
  await assert.rejects(guests.guestAccess(preview.invitationId));
  const { lead: rival } = await manual.create(owner.id, { ...draft, name: "Rival" });
  await sales.accept(rival.id, owner.id);
  const rivalPreview = await calls.preview(owner.id, rival.id, booking);
  const booked = await calls.savePreview(owner.id, lead.id, preview.invitationId);
  assert.equal((await calls.savePreview(owner.id, lead.id, preview.invitationId)).id, booked.id);
  await assert.rejects(calls.savePreview(owner.id, rival.id, rivalPreview.invitationId));
  const slots = await availability.slots(expert.id, { from: start.toISOString(), to: start.toISOString() });
  assert.equal(slots.slots.length, 17);
  assert.equal(slots.slots[0].reason, "BUSY");
  assert.equal(slots.slots.at(-1)?.endTime.getUTCHours(), 12);
  checked("preview allocates a stable link without booking; save revalidates conflicts; busy configured slots remain visible");
  await assert.rejects(experts.detail(otherExpert.id, lead.id));
  await Promise.all([experts.start(expert.id, lead.id), experts.start(expert.id, lead.id)]);
  const confirmed = await calls.respond(expert.id, booked.id, { action: "confirm" });
  assert.equal(confirmed.meeting?.roomName, (await prisma.leadMeetingInvitation.findUniqueOrThrow({ where: { id: preview.invitationId } })).roomName);
  await assert.rejects(guests.guestAccess(preview.invitationId));
  const nowStart = new Date(Date.now() - 60_000),
    nowEnd = new Date(Date.now() + 29 * 60_000);
  await prisma.leadExpertCall.update({ where: { id: booked.id }, data: { startTime: nowStart, endTime: nowEnd } });
  const access = (await guests.guestAccess(preview.invitationId)) as any;
  assert.equal(access.moderator, false);
  assert(!JSON.stringify(access).includes(draft.email));
  await assert.rejects(guests.expertAccess(otherExpert.id, booked.id));
  await experts.saveQuestionnaire(expert.id, lead.id, { birthDate: "2008-04-17", favoriteSubjects: ["Math"], specialConditions: true, specialConditionsComment: "Confidential" });
  await experts.followUp(expert.id, lead.id, { reason: "FOLLOW_UP", comment: "Client needs time" });
  await assert.rejects(guests.guestAccess(preview.invitationId));
  const followUp = await experts.detail(expert.id, lead.id);
  assert.equal(followUp.status, "RECALL");
  assert.equal(followUp.assignedSalesManagerId, owner.id);
  assert.equal(followUp.expertCalls[0].outcome, "FOLLOW_UP");
  assert.equal(await prisma.leadCallback.count({ where: { leadId: lead.id } }), 0);
  checked("expert start is idempotent; confirmation retains room; guest access is scoped; follow-up retains questionnaire and originating Sales");
  const callbackTime = new Date(start.getTime() + 60 * 60_000);
  for (let i = 0; i < 8; i++) await sales.createCallback(lead.id, owner.id, callbackTime, `Attempt ${i}`, "FOLLOW_UP");
  assert.equal(await prisma.leadCallback.count({ where: { leadId: lead.id } }), 8);
  assert.equal(await prisma.leadCallback.count({ where: { leadId: lead.id, status: "SCHEDULED" } }), 1);
  checked("follow-up has no retry limit and keeps all attempts");
  const identity = {
    firstname: "Child",
    lastname: "Smoke",
    email: `${run}-child@example.test`,
    phone: `+7${run.slice(-10)}`,
    subscriptionTier: "EXPERT_MENTORSHIP" as const,
    price: 100000,
    currency: "KZT",
  };
  const [conversion, repeat] = await Promise.all([contracts.prepare(expert.id, lead.id, identity), contracts.prepare(expert.id, lead.id, identity)]);
  assert.equal(conversion.contract.id, repeat.contract.id);
  assert.equal(conversion.lead.status, "CONTRACT_PENDING");
  assert.notEqual(conversion.contract.studentId, owner.id);
  assert.equal(await prisma.leadCallback.count({ where: { leadId: lead.id, status: "SCHEDULED" } }), 0);
  const invitation = await prisma.leadStudentInvitation.findUniqueOrThrow({ where: { userId: conversion.contract.studentId } });
  await invitationService.send(invitation.id);
  await invitationService.send(invitation.id);
  assert.equal(mail.length, 1);
  const token = new URL(mail[0].split(" ").at(-1)!).searchParams.get("token")!;
  await assert.rejects(jwt.verifyAsync(token, { secret: "smoke-test-secret" }));
  await invitationService.accept({ token, password: "Strong-smoke-password" });
  await assert.rejects(invitationService.accept({ token, password: "Second-password" }));
  checked("contract preparation is idempotent; child account is separate; invitation is one-use and not an access token");
  await assert.rejects(contractRepo.expertSign(conversion.contract.id, otherExpert.id));
  await contractRepo.updateMeta(conversion.contract.id, { price: 100001 });
  await contractRepo.expertSign(conversion.contract.id, expert.id);
  await assert.rejects(contractRepo.updateMeta(conversion.contract.id, { price: 1 }));
  await prisma.studentPortrait.update({ where: { userId: conversion.contract.studentId }, data: { consultantProfileId: otherProfile.id } });
  const signData = { clientFullName: "Parent Smoke", studentName: "Child Smoke", clientIin: "000000000000", clientAddress: "Test address", clientPhone: draft.phone };
  await assert.rejects(contractRepo.studentSign(conversion.contract.id, signData));
  assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: conversion.contract.id } })).status, "PENDING_STUDENT");
  await prisma.studentPortrait.update({ where: { userId: conversion.contract.studentId }, data: { consultantProfileId: null } });
  const signed = await Promise.allSettled([contractRepo.studentSign(conversion.contract.id, signData), contractRepo.studentSign(conversion.contract.id, signData)]);
  assert.equal(signed.filter(r => r.status === "fulfilled").length, 1);
  assert.equal((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).status, "CONVERTED");
  assert.equal((await prisma.studentPortrait.findUniqueOrThrow({ where: { userId: conversion.contract.studentId } })).consultantProfileId, profile.id);
  assert.equal(
    (await prisma.studentPackage.findUniqueOrThrow({ where: { studentId_expertId: { studentId: conversion.contract.studentId, expertId: profile.id } } })).totalSlots,
    10,
  );
  await assert.rejects(sales.reject(lead.id, owner.id, "Late rejection"));
  checked("signing atomically converts and assigns; conflicting assignment rolls back; repeated signature cannot duplicate benefits");
  const offlinePreview = await calls.preview(owner.id, rival.id, { ...booking, format: "OFFICE", officeCode: "shymkent" });
  assert.equal(offlinePreview.guestUrl, null);
  assert.equal(offlinePreview.office?.testAddress, false);
  assert.equal(offlinePreview.office?.address, process.env.SALES_OFFICE_SHYMKENT_ADDRESS || "г. Шымкент, ул. Байтерекова 2Б");
  const officeCall = await calls.savePreview(owner.id, rival.id, offlinePreview.invitationId);
  assert.equal(officeCall.officeAddress, offlinePreview.office?.address);
  assert.equal((await calls.respond(expert.id, officeCall.id, { action: "confirm" })).meetingId, null);
  assert.equal((await prisma.lead.findUniqueOrThrow({ where: { id: rival.id } })).status, "OFFICE_INVITED");
  await assert.rejects(guests.guestAccess(offlinePreview.invitationId));
  await experts.followUp(expert.id, rival.id, { reason: "RESCHEDULED" });
  await assert.rejects(contracts.prepare(expert.id, rival.id, identity));
  await assert.rejects(contracts.prepare(expert.id, rival.id, { ...identity, existingStudentId: conversion.contract.studentId }));
  await assert.rejects(calls.preview(owner.id, rival.id, { ...booking, format: "OFFICE", officeCode: "astana" }));
  await assert.rejects(calls.preview(owner.id, rival.id, { ...booking, endTime: new Date(start.getTime() + 60 * 60_000).toISOString() }));
  checked("offline uses the same confirmation flow without JaaS; unsupported office and duration rejected; existing account/contract guarded");
  // Competing previews on different leads must not reserve the same expert slot.
  const third = (await manual.create(owner.id, { ...draft, name: "Third" })).lead;
  await sales.accept(third.id, owner.id);
  const previews = await Promise.all([calls.preview(owner.id, rival.id, booking), calls.preview(owner.id, third.id, booking)]);
  const collision = await Promise.allSettled([calls.savePreview(owner.id, rival.id, previews[0].invitationId), calls.savePreview(owner.id, third.id, previews[1].invitationId)]);
  assert.equal(collision.filter(r => r.status === "fulfilled").length, 1);
  checked("simultaneous booking race admits one reservation");
  const fourth = (await manual.create(owner.id, { ...draft, name: "Fourth" })).lead;
  await sales.accept(fourth.id, owner.id);
  const laterBooking = { ...booking, startTime: new Date(start.getTime() + 3600_000).toISOString(), endTime: new Date(start.getTime() + 5400_000).toISOString() };
  const duplicatePreview = await calls.preview(owner.id, fourth.id, laterBooking);
  const sameSave = await Promise.all([
    calls.savePreview(owner.id, fourth.id, duplicatePreview.invitationId),
    calls.savePreview(owner.id, fourth.id, duplicatePreview.invitationId),
  ]);
  assert.equal(sameSave[0].id, sameSave[1].id);
  const fifth = (await manual.create(owner.id, { ...draft, name: "Fifth" })).lead;
  await sales.accept(fifth.id, owner.id);
  const cancellationPreview = await calls.preview(owner.id, fifth.id, {
    ...booking,
    startTime: new Date(start.getTime() + 7200_000).toISOString(),
    endTime: new Date(start.getTime() + 9000_000).toISOString(),
  });
  const cancelRace = await Promise.allSettled([
    calls.savePreview(owner.id, fifth.id, cancellationPreview.invitationId),
    calls.cancelPreview(owner.id, fifth.id, cancellationPreview.invitationId),
  ]);
  assert.equal(cancelRace.filter(r => r.status === "fulfilled").length, 1);
  const finalInvitation = await prisma.leadMeetingInvitation.findUniqueOrThrow({ where: { id: cancellationPreview.invitationId }, include: { call: true } });
  assert(!(finalInvitation.call && finalInvitation.cancelledAt));
  checked("same-preview save is idempotent under a race; cancelling and saving cannot both succeed");
  const reusable = await createUser("STUDENT", "reusable");
  await prisma.user.update({ where: { id: reusable.id }, data: { phoneNumber: `+8${run.slice(-10)}` } });
  const reuseLead = await prisma.lead.create({ data: { displayName: "Reuse fixture", assignedSalesManagerId: owner.id, assignedExpertUserId: expert.id, status: "RECALL" } });
  const reuseIdentity = { ...identity, email: reusable.email, phone: `+8${run.slice(-10)}` };
  await assert.rejects(contracts.prepare(expert.id, reuseLead.id, reuseIdentity), (error: any) => error.getResponse()?.code === "EXISTING_STUDENT_CONFIRMATION_REQUIRED");
  const reused = await contracts.prepare(expert.id, reuseLead.id, { ...reuseIdentity, existingStudentId: reusable.id });
  assert.equal(reused.contract.studentId, reusable.id);
  assert.equal(reused.invitationRequired, false);
  const tooSoon = new Date(Date.now() + 3600_000);
  tooSoon.setUTCMinutes(0, 0, 0);
  await assert.rejects(calls.preview(owner.id, third.id, { ...booking, startTime: tooSoon.toISOString(), endTime: new Date(tooSoon.getTime() + 1800_000).toISOString() }));
  checked("matching existing student requires explicit confirmation and keeps account; four-hour booking notice enforced");
  console.log(`${checks} integration scenarios passed`);
}
main()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await invitationService.recover();
    await prisma.$disconnect();
  });
