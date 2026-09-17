/** Behavioral regressions from docs/sales-expert-v2-code-review.md.
 * Requires disposable PostgreSQL and Redis; see docs/sales-expert-v2-regression-tests.md.
 */
import "reflect-metadata";
import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { createServer, connect, type Socket, type AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { Logger, type DynamicModule, type Type } from "@nestjs/common";
import { MODULE_METADATA } from "@nestjs/common/constants";
import { ScheduleModule, SchedulerRegistry } from "@nestjs/schedule";
import { Test } from "@nestjs/testing";
import { Queue, Worker, type Job } from "bullmq";
import type { Prisma } from "../generated/prisma/client";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/database/prisma.service";
import { ExpertDashboardRepository } from "../src/modules/expert-dashboard/repository/expert-dashboard.repository";
import type { LeadRealtimeGateway } from "../src/modules/lead/realtime/lead-realtime.gateway";
import { LeadIngestionRepository } from "../src/modules/lead/repository/lead-ingestion.repository";
import { SalesLeadRepository } from "../src/modules/lead/repository/sales-lead.repository";
import { CalculatorQuestionnaireService } from "../src/modules/lead/service/calculator-questionnaire.service";
import { LeadContractService } from "../src/modules/lead/service/lead-contract.service";
import { LeadStudentInvitationService, LeadStudentInvitationProcessor } from "../src/modules/lead/service/lead-student-invitation.service";
import { ContractRepository } from "../src/modules/contract/repository/contract.repository";
import { ManualLeadV2Service } from "../src/modules/lead/service/manual-lead-v2.service";
import { LeadExpertCallService } from "../src/modules/lead/service/lead-expert-call.service";
import { LeadNotificationService } from "../src/modules/lead/service/lead-notification.service";
import { LeadNotificationProcessor } from "../src/modules/lead/service/lead-notification.processor";
import type { MailService } from "../src/modules/mail/mail.service";
import { AccountService } from "../src/modules/account/account.service";
import { UsersRepository } from "../src/modules/admin/users/repository/users.repository";
import { UserEntity } from "../src/modules/admin/users/api/dto/user.entity";
import { instanceToPlain } from "class-transformer";

// Deliberately refuse production URLs, including the application's usual REDIS_URL.
const databaseUrl = new URL(process.env.DATABASE_URL ?? "");
const redisUrl = new URL(process.env.SALES_V2_TEST_REDIS_URL ?? "");
assert(["localhost", "127.0.0.1"].includes(databaseUrl.hostname) && databaseUrl.pathname.endsWith("_test"), "Use a disposable local *_test PostgreSQL database");
assert(["localhost", "127.0.0.1"].includes(redisUrl.hostname) && redisUrl.protocol === "redis:", "Use a disposable local SALES_V2_TEST_REDIS_URL");
const redisConnection = { host: redisUrl.hostname, port: Number(redisUrl.port || 6379), connectTimeout: 5000, retryStrategy: () => null };

const prisma = new PrismaService();
const runId = randomUUID();
const realtime = {
  emitLeadCreated() {},
  emitLeadUpdated() {},
  emitExpertLeadUpdated() {},
} as unknown as LeadRealtimeGateway;
const manual = new ManualLeadV2Service(prisma, new LeadIngestionRepository(prisma), new CalculatorQuestionnaireService(), realtime);
const sales = new SalesLeadRepository(prisma);
const dashboard = Object.assign(new ExpertDashboardRepository(), { prisma });
const contracts = new LeadContractService(prisma, realtime, { enqueue: async () => {} } as unknown as LeadStudentInvitationService);
const config = new ConfigService({ JWT_SECRET: "regression-only-secret", FRONTEND_URL: "https://example.test" });
const jwt = new JwtService();
let sequence = randomInt(100_000_000, 900_000_000);
let managerId: number;
let expertId: number;
let otherProfileId: number;
let countryId: number;

function identity() {
  const id = ++sequence;
  return {
    firstname: "Regression",
    lastname: "Student",
    email: `${runId}-${id}@example.test`,
    phone: `+77${id}`,
    subscriptionTier: "EXPERT_MENTORSHIP" as const,
    price: 100000,
    currency: "KZT",
  };
}

async function createUser(code: string) {
  const dto = identity();
  return prisma.user.create({
    data: { firstname: dto.firstname, lastname: dto.lastname, email: dto.email, phoneNumber: dto.phone, password: "unused-test-hash", role: { connect: { code } } },
  });
}

async function readyLead(questionnaire: Prisma.InputJsonObject = {}) {
  return prisma.lead.create({
    data: { displayName: `Regression ${runId}`, status: "RECALL", assignedSalesManagerId: managerId, assignedExpertUserId: expertId, expertQuestionnaire: questionnaire },
  });
}

async function prepareStudent(questionnaire: Prisma.InputJsonObject = {}) {
  const lead = await readyLead(questionnaire);
  const result = await contracts.prepare(expertId, lead.id, identity());
  const portrait = await prisma.studentPortrait.findUniqueOrThrow({ where: { userId: result.contract.studentId } });
  assert.equal(result.lead.status, "CONTRACT_PENDING");
  assert.equal(portrait.consultantProfileId, null, "Final assignment must wait for signature");
  return { lead, result, portrait };
}

function invitationService(queue: Queue, sendMail: MailService["sendMail"] = async () => {}) {
  return new LeadStudentInvitationService(prisma, jwt, config, { sendMail } as MailService, queue);
}

function newQueue() {
  return new Queue(`lead-invitations-regression-${randomUUID()}`, { connection: redisConnection, prefix: `regression-${runId}` });
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => {
    resolve = done;
  });
  return { promise, resolve };
}

async function within<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out: ${label}`)), 5000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

before(async () => {
  await prisma.$connect();
  for (const code of ["STUDENT", "EXPERT", "SALES_MANAGER"]) await prisma.role.upsert({ where: { code }, create: { code, name: code }, update: {} });
  managerId = (await createUser("SALES_MANAGER")).id;
  expertId = (await createUser("EXPERT")).id;
  await prisma.consultantProfile.create({ data: { userId: expertId, isActive: true } });
  otherProfileId = (await prisma.consultantProfile.create({ data: { userId: (await createUser("EXPERT")).id, isActive: true } })).id;
  countryId = (await prisma.country.upsert({ where: { isoCode: "KZ" }, create: { isoCode: "KZ", nameEn: "Kazakhstan" }, update: {} })).id;
});
after(async () => {
  await prisma.$disconnect();
});

// Resolve the actual application imports, including async modules and forwardRefs.
// Never add ScheduleModule.forRoot() in the regression's test harness: that masks P1.
async function applicationSchedulers() {
  const seen = new Set<unknown>();
  const schedulers: DynamicModule[] = [];
  async function visit(input: unknown) {
    let value = await input;
    if (value && typeof value === "object" && "forwardRef" in value) value = (value as { forwardRef: () => unknown }).forwardRef();
    if (!value || seen.has(value)) return;
    seen.add(value);
    const dynamic = typeof value === "object" && "module" in value ? (value as DynamicModule) : undefined;
    const moduleType = dynamic?.module ?? (value as Type);
    if (dynamic?.module === ScheduleModule) schedulers.push(dynamic);
    for (const imported of [...(Reflect.getMetadata(MODULE_METADATA.IMPORTS, moduleType) ?? []), ...(dynamic?.imports ?? [])]) await visit(imported);
  }
  await visit(AppModule);
  return schedulers;
}

test("P1: application scheduler registers invitation and reminder recovery on Nest startup", async () => {
  const queue = newQueue();
  const module = await Test.createTestingModule({
    imports: await applicationSchedulers(),
    providers: [
      { provide: LeadStudentInvitationService, useFactory: () => invitationService(queue) },
      { provide: LeadNotificationService, useFactory: () => new LeadNotificationService(prisma, queue) },
    ],
  }).compile();
  try {
    await module.init();
    let registered = 0;
    try {
      registered = module.get(SchedulerRegistry).getCronJobs().size;
    } catch {
      /* Missing scheduler is the regression below. */
    }
    assert.equal(registered, 2, "Invitation and reminder @Cron jobs must be registered by application scheduling configuration");
  } finally {
    if (module.get(LeadNotificationService, { strict: false })) await module.get(LeadNotificationService).recover();
    await module.close();
    await queue.close();
  }
});

test("control: the Nest harness discovers the real recovery decorator when scheduling is enabled", async () => {
  const queue = newQueue();
  const module = await Test.createTestingModule({
    imports: [ScheduleModule.forRoot()],
    providers: [{ provide: LeadStudentInvitationService, useFactory: () => invitationService(queue) }],
  }).compile();
  try {
    await module.init();
    assert.equal(module.get(SchedulerRegistry).getCronJobs().size, 1);
  } finally {
    await module.close();
    await queue.close();
  }
});

test("P1: recovery requeues a persisted invitation after enqueue failure", async t => {
  const { result } = await prepareStudent();
  const invitation = await prisma.leadStudentInvitation.findUniqueOrThrow({ where: { userId: result.contract.studentId } });
  const queue = newQueue();
  try {
    const service = invitationService(queue);
    const failure = t.mock.method(queue, "add", async () => {
      throw new Error("Simulated Redis outage");
    });
    t.mock.method(Logger.prototype, "error", () => {});
    await service.enqueue();
    await service.recover();
    assert.equal((await prisma.leadStudentInvitation.findUniqueOrThrow({ where: { id: invitation.id } })).sentAt, null);
    failure.mock.restore();
    await service.recover();
    const jobs = await queue.getJobs(["waiting", "delayed"]);
    assert(jobs.some(job => job.data.invitationId === invitation.id));
  } finally {
    await queue.obliterate({ force: true });
    await queue.close();
  }
});

test("P1: an unsigned CRM student is excluded from both available list and count", async () => {
  const { portrait, result } = await prepareStudent();
  const student = await prisma.user.findUniqueOrThrow({ where: { id: result.contract.studentId } });
  const where = dashboard.portraitWhereAvailable({ search: student.email });
  const [rows, count] = await Promise.all([dashboard.findExpertStudentPortraits(where, 0, 20), dashboard.countExpertStudentPortraits(where)]);
  assert.deepEqual({ ids: rows.map(row => row.id), count }, { ids: [], count: 0 }, `Pending CRM portrait ${portrait.id} must not enter the shared pool`);
});

test("P1: direct assignment cannot claim an unsigned CRM student for another expert", async () => {
  const { portrait } = await prepareStudent();
  const changed = await dashboard.assignPortraitToExpert(portrait.id, otherProfileId);
  const persisted = await prisma.studentPortrait.findUniqueOrThrow({ where: { id: portrait.id } });
  assert.deepEqual({ changed, owner: persisted.consultantProfileId }, { changed: 0, owner: null });
});

test("control: an ordinary unassigned student remains available and can be claimed only once", async () => {
  const user = await createUser("STUDENT");
  const portrait = await prisma.studentPortrait.create({ data: { userId: user.id } });
  const where = dashboard.portraitWhereAvailable({ search: user.email });
  assert.equal(await dashboard.countExpertStudentPortraits(where), 1);
  assert.equal((await dashboard.findExpertStudentPortraits(where, 0, 20))[0]?.id, portrait.id);
  assert.equal(await dashboard.assignPortraitToExpert(portrait.id, otherProfileId), 1);
  assert.equal(await dashboard.assignPortraitToExpert(portrait.id, otherProfileId), 0);
});

test("P1: the CRM student remains reserved after the expert signs", async () => {
  const { result, portrait } = await prepareStudent();
  const repository = Object.assign(new ContractRepository(), { prisma });
  await repository.expertSign(result.contract.id, expertId);
  assert.equal(await dashboard.assignPortraitToExpert(portrait.id, otherProfileId), 0);
  const student = await prisma.user.findUniqueOrThrow({ where: { id: result.contract.studentId } });
  assert.equal(await dashboard.countExpertStudentPortraits(dashboard.portraitWhereAvailable({ search: student.email })), 0);
});

test("P1: concurrent contract preparation and claiming an existing student cannot both succeed", async () => {
  const user = await createUser("STUDENT");
  const portrait = await prisma.studentPortrait.create({ data: { userId: user.id } });
  const lead = await readyLead();
  const [prepared, claimed] = await Promise.allSettled([
    contracts.prepare(expertId, lead.id, { ...identity(), email: user.email, phone: user.phoneNumber!, existingStudentId: user.id }),
    dashboard.assignPortraitToExpert(portrait.id, otherProfileId),
  ]);
  assert(prepared.status === "fulfilled" || claimed.status === "fulfilled");
  assert(!(prepared.status === "fulfilled" && claimed.status === "fulfilled" && claimed.value === 1));
  const saved = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
  const owner = await prisma.studentPortrait.findUniqueOrThrow({ where: { id: portrait.id } });
  assert(!(saved.contractId && owner.consultantProfileId === otherProfileId), "Pending contract must never coexist with another expert's claim");
});

test("P2: a new student's citizenship reaches the canonical User field", async () => {
  const { result } = await prepareStudent({ citizenshipCountryId: countryId, birthDate: "2008-04-17" });
  const user = await prisma.user.findUniqueOrThrow({ where: { id: result.contract.studentId } });
  assert.equal(user.citizenshipCountryId, countryId);
});

test("middlename: contract preparation persists three name fields and retries preserve them", async () => {
  const lead = await readyLead();
  const dto = { ...identity(), firstname: "Алия", lastname: "Омарова", middlename: "  Серік қызы  " };
  const result = await contracts.prepare(expertId, lead.id, dto);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: result.contract.studentId } });
  assert.equal(user.firstname, "Алия");
  assert.equal(user.lastname, "Омарова");
  assert.equal(user.middlename, "Серік қызы");

  const repo = Object.assign(new ContractRepository(), { prisma });
  const contract = (await repo.findByStudentId(user.id)) as unknown as { student: { middlename: string | null } };
  assert.equal(contract.student.middlename, user.middlename);
  const listed = (await repo.findAllByStatus("PENDING_EXPERT", expertId)) as unknown as { id: string; student: { middlename: string | null } }[];
  assert.equal(listed.find(item => item.id === result.contract.id)?.student.middlename, user.middlename);

  const users = new UsersRepository(prisma);
  const profile = instanceToPlain(new UserEntity((await users.findById(user.id))!));
  assert.equal(profile.middlename, user.middlename);
  assert(!("password" in profile));

  const retry = await contracts.prepare(expertId, lead.id, { ...dto, middlename: "Другое" });
  assert.equal(retry.contract.id, result.contract.id);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).middlename, user.middlename);
});

for (const middlename of [undefined, null, "", "   "]) {
  test(`middlename: new account accepts ${JSON.stringify(middlename)} without inventing a name`, async () => {
    const lead = await readyLead();
    const result = await contracts.prepare(expertId, lead.id, { ...identity(), middlename });
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: result.contract.studentId } })).middlename, null);
  });
}

for (const isIdentityLocked of [false, true]) {
  for (const previous of [null, "Сохранённое"]) {
    test(`middlename: reuse preserves identity (locked=${isIdentityLocked}, previous=${previous})`, async () => {
      const user = await createUser("STUDENT");
      await prisma.user.update({ where: { id: user.id }, data: { middlename: previous } });
      await prisma.studentPortrait.create({ data: { userId: user.id, isIdentityLocked } });
      const lead = await readyLead();
      const dto = { ...identity(), email: user.email, phone: user.phoneNumber!, middlename: "Новое" };
      await assert.rejects(contracts.prepare(expertId, lead.id, dto), /Confirm reuse/);
      assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).middlename, previous);

      await contracts.prepare(expertId, lead.id, { ...dto, existingStudentId: user.id });
      const saved = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      assert.equal(saved.middlename, isIdentityLocked || previous ? previous : "Новое");
      assert.equal(saved.firstname, user.firstname);
      assert.equal(saved.lastname, user.lastname);
      assert.equal(saved.password, user.password);
    });
  }
}

test("middlename: account updates support setting, omission and explicit clearing", async () => {
  const user = await createUser("STUDENT");
  const account = new AccountService(prisma);
  const updated = await account.updateProfile(user.id, { middlename: "  Сериковна  " });
  assert.equal(updated.middlename, "Сериковна");
  assert(!("password" in instanceToPlain(updated)));
  assert.equal((await account.updateProfile(user.id, { firstname: "Алия" })).middlename, "Сериковна");
  assert.equal((await account.updateProfile(user.id, { middlename: null })).middlename, null);
  await account.updateProfile(user.id, { middlename: "Сериковна" });
  assert.equal((await account.updateProfile(user.id, { middlename: "   " })).middlename, null);
});

test("control: a new portrait retains birth date and the complete questionnaire without invented language levels", async () => {
  const questionnaire = { birthDate: "2008-04-17", languages: ["English"], otherLanguage: "Fixture language", favoriteSubjects: ["Math"] };
  const { portrait } = await prepareStudent(questionnaire);
  assert.equal(portrait.birthDate?.toISOString(), "2008-04-17T00:00:00.000Z");
  assert.deepEqual((portrait.meta as Prisma.JsonObject).expertQuestionnaire, questionnaire);
  assert.equal(
    await prisma.userLanguages.count({ where: { portraitId: portrait.id, level: { in: ["A1", "A2", "B1", "B2", "C1", "C2"] } } }),
    0,
    "The questionnaire supplies no proficiency level",
  );
});

async function reuseStudent(portraitData: Pick<Prisma.StudentPortraitUncheckedCreateInput, "birthDate" | "meta" | "isIdentityLocked"> = {}) {
  const user = await createUser("STUDENT");
  await prisma.studentPortrait.create({ data: { userId: user.id, ...portraitData } });
  const questionnaire = { birthDate: "2008-04-17", citizenshipCountryId: countryId, languages: ["English"] };
  const lead = await readyLead(questionnaire);
  const result = await contracts.prepare(expertId, lead.id, { ...identity(), email: user.email, phone: user.phoneNumber!, existingStudentId: user.id });
  assert.equal(result.invitationRequired, false);
  return { user, lead, questionnaire, portrait: await prisma.studentPortrait.findUniqueOrThrow({ where: { userId: user.id } }) };
}

test("P2: reusing an unlocked profile fills its missing birth date", async () => {
  const { portrait, user } = await reuseStudent();
  assert.equal(portrait.birthDate?.toISOString(), "2008-04-17T00:00:00.000Z");
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).citizenshipCountryId, countryId);
});

test("P2: reusing a profile preserves legacy metadata that is not an object", async () => {
  const { portrait, questionnaire } = await reuseStudent({ meta: ["legacy answer"] });
  assert.deepEqual((portrait.meta as Prisma.JsonObject).legacyMeta, ["legacy answer"]);
  assert.deepEqual((portrait.meta as Prisma.JsonObject).expertQuestionnaire, questionnaire);
});

test("P2: reusing a profile stores the questionnaire snapshot while preserving unrelated metadata", async () => {
  const { portrait, questionnaire } = await reuseStudent({ meta: { legacyNote: "Keep this", preferences: { contact: "email" } } });
  const meta = portrait.meta as Prisma.JsonObject;
  assert.equal(meta.legacyNote, "Keep this");
  assert.deepEqual(meta.preferences, { contact: "email" });
  assert.deepEqual(meta.expertQuestionnaire, questionnaire);
});

test("control: reuse preserves locked identity, existing birth date, and password", async () => {
  const { user, portrait } = await reuseStudent({ birthDate: new Date("2007-01-02"), isIdentityLocked: true });
  const saved = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  assert.equal(portrait.birthDate?.toISOString(), "2007-01-02T00:00:00.000Z");
  assert.equal(portrait.isIdentityLocked, true);
  assert.equal(saved.firstname, user.firstname);
  assert.equal(saved.lastname, user.lastname);
  assert.equal(saved.password, user.password);
});

test("P2: identity locking also preserves empty canonical fields while retaining the questionnaire", async () => {
  const { user, portrait, questionnaire } = await reuseStudent({ isIdentityLocked: true });
  assert.equal(portrait.birthDate, null);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).citizenshipCountryId, null);
  assert.deepEqual((portrait.meta as Prisma.JsonObject).expertQuestionnaire, questionnaire);
});

async function manualLead(role: "parent" | "student") {
  const dto = identity();
  const { lead } = await manual.create(managerId, { name: dto.firstname, phone: dto.phone, email: dto.email, role, locale: "ru", answers: [] });
  assert(await sales.accept(lead.id, managerId));
  return lead;
}

for (const role of ["parent", "student"] as const) {
  test(`P2: ${role} questionnaire locale stays consistent in Sales detail and list`, async () => {
    const lead = await manualLead(role);
    const saved = await manual.saveAnswers(managerId, lead.id, { role, locale: "kk", answers: [] });
    assert.equal((saved.normalizedPayload as Prisma.JsonObject).preferredLanguage, "kk");
    const detail = await sales.findVisibleById(lead.id, managerId);
    const list = await sales.list(managerId, { status: "NEW", page: 1, limit: 20, search: lead.email! });
    assert.deepEqual({ detail: detail?.preferredLanguage, list: list.data.find(row => row.id === lead.id)?.preferredLanguage }, { detail: "kk", list: "kk" });
  });
}

test("control: saving answers preserves historical submissions and rejects another Sales manager", async () => {
  const lead = await manualLead("parent");
  const before = await prisma.leadSubmission.findMany({ where: { leadId: lead.id } });
  await manual.saveAnswers(managerId, lead.id, { role: "parent", locale: "kk", answers: [] });
  assert.deepEqual(await prisma.leadSubmission.findUniqueOrThrow({ where: { id: before[0].id } }), before[0]);
  const otherManager = await createUser("SALES_MANAGER");
  await assert.rejects(manual.saveAnswers(otherManager.id, lead.id, { role: "parent", locale: "ru", answers: [] }), { status: 404 });
  assert.equal(await prisma.leadSubmission.count({ where: { leadId: lead.id } }), 2);
});

test("P2: questionnaire and lead language both roll back if activity persistence fails", async () => {
  const lead = await manualLead("parent");
  const failingPrisma = prisma.$extends({
    query: {
      leadActivity: {
        create() {
          throw new Error("Simulated activity failure");
        },
      },
    },
  });
  const service = new ManualLeadV2Service(failingPrisma as unknown as PrismaService, new LeadIngestionRepository(prisma), new CalculatorQuestionnaireService(), realtime);
  await assert.rejects(service.saveAnswers(managerId, lead.id, { role: "parent", locale: "kk", answers: [] }), /Simulated activity failure/);
  assert.equal((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).preferredLanguage, "ru");
  assert.equal(await prisma.leadSubmission.count({ where: { leadId: lead.id } }), 1);
});

test("manual creation accepts required contacts with the questionnaire omitted", async () => {
  const dto = identity();
  const { lead } = await manual.create(managerId, { name: dto.firstname, phone: dto.phone, email: dto.email, role: "parent", locale: "kk" });
  assert.equal(lead.status, "NEW");
  assert.equal(lead.assignedSalesManagerId, null);
  const snapshot = await prisma.leadSubmission.findFirstOrThrow({ where: { leadId: lead.id } });
  assert.deepEqual(((snapshot.normalizedPayload as Prisma.JsonObject).questionnaire as Prisma.JsonObject).answers, []);
});

test("P2: stale and legacy jobs cannot deliver a newer generation; current delivery is idempotent", async () => {
  const { lead, result } = await prepareStudent();
  const invitation = await prisma.leadStudentInvitation.findUniqueOrThrow({ where: { userId: result.contract.studentId } });
  const queue = newQueue();
  const mails: string[] = [];
  const service = invitationService(queue, async (_to, _subject, text) => {
    mails.push(text);
  });
  const processor = new LeadStudentInvitationProcessor(service);
  try {
    await service.resend(expertId, lead.id);
    await processor.process({ data: { invitationId: invitation.id, deliveryVersion: invitation.deliveryVersion } } as Job);
    await processor.process({ data: { invitationId: invitation.id } } as Job);
    assert.equal(mails.length, 0);
    assert.equal((await prisma.leadStudentInvitation.findUniqueOrThrow({ where: { id: invitation.id } })).sentAt, null);
    const jobs = await queue.getJobs(["waiting"]);
    const current = jobs.find(job => job.data.invitationId === invitation.id)!;
    assert(current);
    await processor.process(current);
    await processor.process(current);
    assert.equal(mails.length, 1);
    const token = new URL(mails[0].split(" ").at(-1)!).searchParams.get("token")!;
    await service.accept({ token, password: "Regression-password" });
    await assert.rejects(service.accept({ token, password: "Another-password" }), { status: 400 });
    await assert.rejects(service.resend(expertId, lead.id), { status: 409 });
  } finally {
    await queue.obliterate({ force: true });
    await queue.close();
  }
});

test("P2: resend during an active BullMQ delivery cannot mark an older token as the renewed invitation", async () => {
  const { lead, result } = await prepareStudent();
  const invitation = await prisma.leadStudentInvitation.update({ where: { userId: result.contract.studentId }, data: { expiresAt: new Date(Date.now() + 3600_000) } });
  const queue = newQueue();
  const mailStarted = deferred();
  const releaseMail = deferred();
  const completed = deferred();
  const deliveredExpirations: number[] = [];
  const service = invitationService(queue, async (_to, _subject, body) => {
    const token = new URL(body.split(" ").at(-1)!).searchParams.get("token")!;
    const payload = await jwt.verifyAsync<{ exp: number }>(token, { secret: "regression-only-secret:lead-student-invitation", audience: "lead-student-invitation" });
    mailStarted.resolve();
    await releaseMail.promise;
    deliveredExpirations.push(payload.exp);
  });
  const processor = new LeadStudentInvitationProcessor(service);
  const worker = new Worker(queue.name, job => processor.process(job), {
    connection: redisConnection,
    prefix: queue.opts.prefix,
    autorun: false,
  });
  const workerErrors: Error[] = [];
  worker.on("error", error => workerErrors.push(error));
  worker.on("failed", (_job, error) => workerErrors.push(error));
  worker.once("completed", completed.resolve);
  const running = worker.run();
  try {
    await service.enqueue();
    await service.recover();
    await within(mailStarted.promise, "first delivery starts");
    assert.equal(await queue.getActiveCount(), 1, "The original BullMQ job must still be active during resend");
    await service.resend(expertId, lead.id);
    const renewed = await prisma.leadStudentInvitation.findUniqueOrThrow({ where: { id: invitation.id } });
    assert(renewed.expiresAt > invitation.expiresAt);
    releaseMail.resolve();
    await within(completed.promise, "first delivery completes");
    await worker.pause();
    assert.deepEqual(workerErrors, []);
    const persisted = await prisma.leadStudentInvitation.findUniqueOrThrow({ where: { id: invitation.id } });
    const renewedTokenDelivered = deliveredExpirations.includes(Math.floor(renewed.expiresAt.getTime() / 1000));
    assert(persisted.sentAt === null || renewedTokenDelivered, "Renewed invitation is marked sent although only the old, short-lived token was delivered");
    // Pending generations must remain recoverable even if queue insertion was deduplicated.
    if (!renewedTokenDelivered) {
      await service.recover();
      const pending = await queue.getJobs(["waiting", "delayed"]);
      assert(
        pending.some(job => job.data.invitationId === invitation.id),
        "Renewed invitation must still have a delivery scheduled",
      );
      const renewedCompleted = deferred();
      worker.on("completed", job => {
        if (job.data.invitationId === invitation.id && job.data.deliveryVersion === renewed.deliveryVersion) renewedCompleted.resolve();
      });
      worker.resume();
      await within(renewedCompleted.promise, "renewed delivery completes");
      await worker.pause();
    }
    assert(deliveredExpirations.includes(Math.floor(renewed.expiresAt.getTime() / 1000)), "The renewed token must actually reach the mail service");
    assert((await prisma.leadStudentInvitation.findUniqueOrThrow({ where: { id: invitation.id } })).sentAt);
  } finally {
    releaseMail.resolve();
    await worker.close();
    await running;
    await queue.obliterate({ force: true });
    await queue.close();
  }
});

test("Sales review: summary preserves queue visibility with one grouped query", async () => {
  const owner = await createUser("SALES_MANAGER");
  const other = await createUser("SALES_MANAGER");
  const statuses = ["NEW", "CALL_SCHEDULED", "OFFICE_INVITED", "RECALL", "REJECTED", "CONTRACT_PENDING", "CONVERTED"] as const;
  const baseline = await sales.summary(owner.id);
  await prisma.lead.createMany({
    data: statuses.flatMap(status => [
      { status, assignedSalesManagerId: owner.id },
      { status, assignedSalesManagerId: other.id },
      { status, assignedSalesManagerId: owner.id, deletedAt: new Date() },
    ]),
  });
  await prisma.lead.createMany({ data: [{ status: "NEW" }, { status: "RECALL" }] });
  const summary = await sales.summary(owner.id);
  for (const status of statuses) assert.equal(summary[status], baseline[status] + (status === "NEW" ? 2 : 1), status);
});

test("Sales review: numeric phone searches cannot overflow a PostgreSQL lead ID", async () => {
  const contacts = identity();
  const lead = await prisma.lead.create({ data: { status: "NEW", assignedSalesManagerId: managerId, phoneNumber: contacts.phone } });
  const result = await sales.list(managerId, { status: "NEW", search: contacts.phone.slice(1), page: 1, limit: 10 });
  assert(result.data.some(row => row.id === lead.id));
  assert.equal((await sales.list(managerId, { status: "NEW", search: "9".repeat(100), page: 1, limit: 10 })).total, 0);
  assert((await sales.list(managerId, { status: "NEW", search: String(lead.id), page: 1, limit: 10 })).data.some(row => row.id === lead.id));
});

test("Sales review: equal submission timestamps still return the latest snapshot first", async () => {
  const lead = await readyLead();
  const source = await prisma.leadSource.findFirstOrThrow();
  const receivedAt = new Date();
  await prisma.leadSubmission.create({ data: { leadId: lead.id, sourceId: source.id, receivedAt, rawPayload: {}, metrics: { score: 1 } } });
  const newest = await prisma.leadSubmission.create({ data: { leadId: lead.id, sourceId: source.id, receivedAt, rawPayload: {}, metrics: { score: 2 } } });
  assert.equal((await sales.findVisibleById(lead.id, managerId))?.submissions[0].id, newest.id);
  const result = await sales.list(managerId, { status: "RECALL", search: String(lead.id), page: 1, limit: 10 });
  assert.equal(result.data.find(row => row.id === lead.id)?.submissions[0].id, newest.id);
});

test("Sales review: editing callback comments does not recreate pending or delivered reminders", async () => {
  const lead = await readyLead();
  const scheduledFor = new Date(Date.now() + 86400_000);
  const result = await sales.createCallback(lead.id, managerId, scheduledFor);
  await sales.updateCallback(result.callback.id, lead.id, managerId, { comment: "Clarify documents", scheduledFor });
  assert.equal(await prisma.notificationLog.count({ where: { leadId: lead.id, type: "LEAD_CALLBACK_REMINDER" } }), 1);
  await prisma.notificationLog.update({ where: { id: result.notification.id }, data: { status: "SENT", sentAt: new Date() } });
  await sales.updateCallback(result.callback.id, lead.id, managerId, { comment: "Customer replied" });
  assert.equal(await prisma.notificationLog.count({ where: { leadId: lead.id, type: "LEAD_CALLBACK_REMINDER" } }), 1);
  const changed = await sales.updateCallback(result.callback.id, lead.id, managerId, { scheduledFor: new Date(scheduledFor.getTime() + 900_000) });
  assert.equal(changed.kind, "updated");
  assert.equal(await prisma.notificationLog.count({ where: { leadId: lead.id, status: "PENDING" } }), 1);
  await sales.updateCallback(result.callback.id, lead.id, managerId, { status: "COMPLETED" });
  assert.equal(await prisma.notificationLog.count({ where: { leadId: lead.id, status: "PENDING" } }), 0);
  assert.equal((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).status, "RECALL");
});

test("Sales review: former owners and deleted leads cannot mutate meeting requests or reuse saved previews", async () => {
  const calls = new LeadExpertCallService(prisma, realtime);
  const otherManager = await createUser("SALES_MANAGER");
  const otherExpert = await createUser("EXPERT");
  for (const deleted of [false, true]) {
    const lead = await readyLead();
    const invitation = await prisma.leadMeetingInvitation.create({
      data: {
        leadId: lead.id,
        salesManagerId: managerId,
        roomName: randomUUID(),
        booking: {},
        expiresAt: new Date(Date.now() + 86400_000),
      },
    });
    const call = await prisma.leadExpertCall.create({
      data: {
        leadId: lead.id,
        salesManagerId: managerId,
        expertUserId: expertId,
        invitationId: invitation.id,
        startTime: new Date(Date.now() + 86400_000),
        endTime: new Date(Date.now() + 88200_000),
      },
    });
    if (deleted) await prisma.lead.update({ where: { id: lead.id }, data: { deletedAt: new Date() } });
    else await prisma.lead.update({ where: { id: lead.id }, data: { assignedSalesManagerId: otherManager.id, assignedExpertUserId: otherExpert.id } });
    await assert.rejects(calls.update(managerId, lead.id, call.id, { comment: "Stale edit" }), { status: 404 });
    await assert.rejects(calls.respond(expertId, call.id, { action: "confirm" }), { status: 404 });
    await assert.rejects(calls.respond(expertId, call.id, { action: "decline" }), { status: 404 });
    await assert.rejects(calls.savePreview(managerId, lead.id, invitation.id), { status: 404 });
    if (deleted) await assert.rejects(calls.detailForExpert(expertId, call.id), { status: 404 });
    assert.equal((await prisma.leadExpertCall.findUniqueOrThrow({ where: { id: call.id } })).status, "REQUESTED");
    assert.equal(await prisma.leadActivity.count({ where: { leadId: lead.id } }), 0);
    const draft = await prisma.leadMeetingInvitation.create({
      data: {
        leadId: lead.id,
        salesManagerId: managerId,
        roomName: randomUUID(),
        booking: {},
        expiresAt: new Date(Date.now() + 86400_000),
      },
    });
    await assert.rejects(calls.cancelPreview(managerId, lead.id, draft.id), { status: 409 });
    assert.equal((await prisma.leadMeetingInvitation.findUniqueOrThrow({ where: { id: draft.id } })).cancelledAt, null);
  }
});

test("Sales review: recovery delivers a persisted reminder after queue failure, only once", async t => {
  const lead = await readyLead();
  const reminder = await prisma.notificationLog.create({
    data: {
      userId: managerId,
      leadId: lead.id,
      channel: "IN_APP",
      type: "LEAD_CALLBACK_REMINDER",
      status: "PENDING",
      content: "Callback",
      scheduledFor: new Date(Date.now() - 1000),
    },
  });
  const queue = newQueue();
  const delivered: number[] = [];
  const processor = new LeadNotificationProcessor(prisma, {
    emitNotification(_userId: number, notification: { id: number }) {
      delivered.push(notification.id);
    },
  } as LeadRealtimeGateway);
  const service = new LeadNotificationService(prisma, queue);
  const worker = new Worker(queue.name, job => processor.process(job), { connection: redisConnection, prefix: queue.opts.prefix, autorun: false });
  try {
    t.mock.method(Logger.prototype, "warn", () => {});
    const outage = t.mock.method(queue, "add", async () => {
      throw new Error("Redis unavailable");
    });
    await service.schedule();
    await service.recover();
    assert.equal((await prisma.notificationLog.findUniqueOrThrow({ where: { id: reminder.id } })).status, "PENDING");
    outage.mock.restore();
    await service.recover();
    const done = deferred();
    worker.on("completed", job => {
      if (job.data.notificationId === reminder.id) done.resolve();
    });
    void worker.run();
    await within(done.promise, "callback reminder recovery");
    await processor.process({ data: { notificationId: reminder.id } } as Job<{ notificationId: number }>);
    assert.equal(delivered.filter(id => id === reminder.id).length, 1);
    assert.equal((await prisma.notificationLog.findUniqueOrThrow({ where: { id: reminder.id } })).status, "SENT");
  } finally {
    await worker.close();
    await queue.obliterate({ force: true });
    await queue.close();
  }
});

test("Sales review: recovery retries failed reminder jobs retained by an older deployment", async () => {
  const reminder = await prisma.notificationLog.create({
    data: { userId: managerId, channel: "IN_APP", type: "LEAD_CALLBACK_REMINDER", status: "PENDING", content: "Callback", scheduledFor: new Date(Date.now() - 1000) },
  });
  const queue = newQueue();
  const worker = new Worker(
    queue.name,
    async () => {
      throw new Error("Delivery failed");
    },
    { connection: redisConnection, prefix: queue.opts.prefix, autorun: false },
  );
  try {
    const failed = deferred();
    worker.on("failed", () => failed.resolve());
    await queue.add("deliver", { notificationId: reminder.id }, { jobId: `lead-notification-${reminder.id}`, attempts: 1, removeOnFail: false });
    void worker.run();
    await within(failed.promise, "retained failed reminder");
    await worker.close();
    const service = new LeadNotificationService(prisma, queue);
    await service.schedule();
    await service.recover();
    assert.equal(await (await queue.getJob(`lead-notification-${reminder.id}`))?.getState(), "waiting");
  } finally {
    await worker.close();
    await queue.obliterate({ force: true });
    await queue.close();
  }
});

test("P1: real Redis disconnect never blocks callers and the same queues recover persisted deliveries", async () => {
  const { result } = await prepareStudent();
  const invitation = await prisma.leadStudentInvitation.findUniqueOrThrow({ where: { userId: result.contract.studentId } });
  const reminder = await prisma.notificationLog.create({
    data: { userId: managerId, channel: "IN_APP", type: "LEAD_CALLBACK_REMINDER", status: "PENDING", content: "Redis reconnect regression", scheduledFor: new Date() },
  });
  const sockets = new Set<Socket>();
  const proxy = createServer(socket => {
    const upstream = connect({ host: redisConnection.host, port: redisConnection.port });
    for (const connection of [socket, upstream]) {
      sockets.add(connection);
      connection.on("close", () => sockets.delete(connection));
      connection.on("error", () => {
        socket.destroy();
        upstream.destroy();
      });
    }
    socket.pipe(upstream).pipe(socket);
    socket.on("close", () => upstream.destroy());
  });
  await new Promise<void>(resolve => proxy.listen(0, "127.0.0.1", resolve));
  const port = (proxy.address() as AddressInfo).port;
  await new Promise<void>(resolve => proxy.close(() => resolve()));
  // Default BullMQ reconnect behavior, unlike the immediate-rejection queue mock.
  const queue = new Queue(`real-outage-${randomUUID()}`, { connection: { host: "127.0.0.1", port }, prefix: `regression-${runId}` });
  const refused = deferred();
  queue.on("error", () => refused.resolve());
  let deliveredInvitations = 0,
    deliveredReminders = 0;
  const sentInvitation = deferred(),
    sentReminder = deferred();
  const invitations = invitationService(queue, async email => {
    const target = await prisma.user.findUniqueOrThrow({ where: { id: invitation.userId } });
    if (email === target.email) {
      deliveredInvitations++;
      sentInvitation.resolve();
    }
  });
  const notifications = new LeadNotificationService(prisma, queue);
  const processor = new LeadNotificationProcessor(prisma, {
    emitNotification: (_userId: number, value: { id: number }) => {
      if (value.id === reminder.id) {
        deliveredReminders++;
        sentReminder.resolve();
      }
    },
  } as unknown as LeadRealtimeGateway);
  let worker: Worker | undefined;
  try {
    await within(refused.promise, "actual refused Redis connection");
    const started = Date.now();
    await within(Promise.all([invitations.enqueue(), notifications.schedule()]), "caller returns during Redis outage");
    assert(Date.now() - started < 500, "Persisted delivery must not wait for Redis reconnect");
    assert.equal((await prisma.leadStudentInvitation.findUniqueOrThrow({ where: { id: invitation.id } })).sentAt, null);
    assert.equal((await prisma.notificationLog.findUniqueOrThrow({ where: { id: reminder.id } })).status, "PENDING");
    // Restore connectivity without constructing a replacement producer or manually adding jobs.
    await new Promise<void>(resolve => proxy.listen(port, "127.0.0.1", resolve));
    await within(Promise.all([invitations.recover(), notifications.recover()]), "background enqueue after Redis reconnect");
    worker = new Worker(
      queue.name,
      async job => {
        if (job.name === "invite") await invitations.send(job.data.invitationId, job.data.deliveryVersion);
        else await processor.process(job);
      },
      { connection: redisConnection, prefix: queue.opts.prefix },
    );
    await within(Promise.all([sentInvitation.promise, sentReminder.promise]), "persisted deliveries processed");
    await worker.close();
    worker = undefined;
    assert.equal(deliveredInvitations, 1);
    assert.equal(deliveredReminders, 1);
    assert((await prisma.leadStudentInvitation.findUniqueOrThrow({ where: { id: invitation.id } })).sentAt);
    assert.equal((await prisma.notificationLog.findUniqueOrThrow({ where: { id: reminder.id } })).status, "SENT");
    await queue.obliterate({ force: true });
  } finally {
    await worker?.close();
    await queue.close();
    for (const socket of sockets) socket.destroy();
    if (proxy.listening) await new Promise<void>(resolve => proxy.close(() => resolve()));
    await Promise.allSettled([invitations.recover(), notifications.recover()]);
  }
});
