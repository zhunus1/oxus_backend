/** Run against an empty disposable local migrated *_test database. */
import "reflect-metadata";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { after, test } from "node:test";
import { PrismaService } from "../src/database/prisma.service";
import { seedSalesExpertDemo } from "../src/prisma/seed/sales-expert-demo.seed";
import { DEMO_EXPERT_EMAIL, DEMO_SALES_EMAIL, demoBatchKey, demoScenarios, demoTime, normalizeDemoOptions } from "../src/prisma/seed/sales-expert-demo.plan";
import { LEAD_PERMISSION } from "../src/modules/lead/domain/lead.constants";
import { SalesLeadRepository } from "../src/modules/lead/repository/sales-lead.repository";
import { ExpertLeadService } from "../src/modules/lead/service/expert-lead.service";
import type { LeadRealtimeGateway } from "../src/modules/lead/realtime/lead-realtime.gateway";

const url = new URL(process.env.DATABASE_URL ?? "");
assert(["127.0.0.1", "localhost"].includes(url.hostname) && url.pathname.endsWith("_test"), "Use a disposable local *_test database");
const prisma = new PrismaService();
after(() => prisma.$disconnect());

test("36 CRM fixtures: read-only preview, relations, visibility, preserved progress and atomic failure", async () => {
  assert.equal(await prisma.user.count(), 0, "Use an empty migrated database");
  process.env.STAGING = "true";
  for (const code of ["SALES_MANAGER", "EXPERT", "STUDENT"]) {
    await prisma.role.upsert({ where: { code }, create: { code, name: code }, update: {} });
  }
  for (const code of Object.values(LEAD_PERMISSION)) {
    const roles = { connect: { code: code === LEAD_PERMISSION.RESPOND_EXPERT_CALL ? "EXPERT" : "SALES_MANAGER" } };
    await prisma.permission.upsert({ where: { code }, create: { code, name: code, roles }, update: { roles } });
  }
  const manager = await prisma.user.create({
    data: { firstname: "Sales", lastname: "Test", email: DEMO_SALES_EMAIL, password: "unused", role: { connect: { code: "SALES_MANAGER" } } },
  });
  const expert = await prisma.user.create({
    data: { firstname: "Expert", lastname: "Test", email: DEMO_EXPERT_EMAIL, password: "unused", role: { connect: { code: "EXPERT" } }, consultantProfile: { create: {} } },
  });
  // Migrations already register sources on a fresh database; do not assume IDs.
  for (const code of ["office-manual", "landing-calculator"]) await prisma.leadSource.upsert({ where: { code }, create: { code, name: code }, update: {} });
  const now = new Date("2026-09-11T06:00:00Z");
  const options = { apply: false };
  const startDate = normalizeDemoOptions(options, now).startDate;
  const profile = await prisma.consultantProfile.findUniqueOrThrow({ where: { userId: expert.id } });
  const occupied = await prisma.consultation.create({
    data: {
      clientId: manager.id,
      consultantProfileId: profile.id,
      startTime: demoTime(startDate, 11 * 60 + 30),
      endTime: demoTime(startDate, 12 * 60),
      status: "CONFIRMED",
    },
  });
  const preview = await seedSalesExpertDemo(prisma, options, now);
  assert.equal(preview.toCreate, 36);
  assert.equal(preview.schedulesToAdd.length, 3);
  assert.equal(await prisma.lead.count(), 0);
  assert.equal(await prisma.expertSchedule.count(), 0);

  const result = await seedSalesExpertDemo(prisma, { ...options, apply: true }, now);
  assert.equal(result.created, 36);
  assert.equal(await prisma.lead.count(), 36);
  assert.equal(await prisma.user.count(), 5, "Exactly three isolated demo student accounts");
  assert.equal(await prisma.leadStudentInvitation.count(), 0, "No activation email recovery jobs");
  assert.equal(await prisma.notificationLog.count({ where: { channel: { not: "IN_APP" } } }), 0, "No outgoing email/SMS records");

  const sales = new SalesLeadRepository(prisma);
  assert.deepEqual(await sales.summary(manager.id), { NEW: 9, CALL_SCHEDULED: 6, RECALL: 9, REJECTED: 3, OFFICE_INVITED: 6, CONTRACT_PENDING: 2, CONVERTED: 1 });
  const experts = new ExpertLeadService(prisma, {} as LeadRealtimeGateway);
  assert.deepEqual(await experts.summary(expert.id), { NEW: 12, FOLLOW_UP: 6, CONTRACTS: 3, ARCHIVE: 3 });
  assert.equal((await experts.list(expert.id, { tab: "NEW", page: 1, limit: 20 })).data.length, 12);
  const calls = await prisma.leadExpertCall.findMany({ include: { meeting: true, invitation: true, lead: true }, orderBy: { startTime: "asc" } });
  for (const [i, call] of calls.entries()) {
    assert(call.invitationId, "Every call uses the v2 invitation flow");
    assert(call.createdAt < call.startTime && call.startTime.getTime() - call.createdAt.getTime() >= 4 * 3_600_000);
    assert(call.lead.createdAt < call.createdAt);
    assert(call.endTime <= occupied.startTime || call.startTime >= occupied.endTime, "Existing consultations are respected");
    if (i) assert(calls[i - 1].endTime <= call.startTime, "No overlapping demo appointments, including history");
    if (call.format === "OFFICE") assert.equal(call.meetingId, null);
    if (call.status === "CONFIRMED" && call.format === "ONLINE") {
      assert.equal(call.meeting!.roomName, call.invitation!.roomName);
      assert.equal(call.meeting!.status, "SCHEDULED");
    }
    if (call.completedAt) assert(call.completedAt <= now);
  }
  const pending = await prisma.contract.findMany({ where: { status: { not: "SIGNED" } }, include: { student: { include: { portrait: true, studentPackages: true } } } });
  assert.equal(pending.length, 2);
  for (const contract of pending) {
    assert.equal(contract.student.portrait!.consultantProfileId, null);
    assert.equal(contract.student.portrait!.subscription, "FREE");
    assert.equal(contract.student.studentPackages.length, 0);
  }
  const signed = await prisma.contract.findFirstOrThrow({ where: { status: "SIGNED" }, include: { lead: true, student: { include: { portrait: true, studentPackages: true } } } });
  assert.equal(signed.lead!.status, "CONVERTED");
  assert.equal(signed.student.portrait!.subscription, "EXPERT_MENTORSHIP");
  assert.equal(signed.student.studentPackages[0].totalSlots, 10);

  // Simulate frontend progress and ensure a later run on the same local day preserves it.
  const first = result.entries.find(entry => entry.code === "S01")!;
  // The old fixed-account script used date-only markers; these must remain recognized.
  await prisma.leadSubmission.updateMany({ where: { leadId: first.leadId! }, data: { externalSubmissionId: `${demoBatchKey(startDate)}:S01` } });
  await sales.accept(first.leadId!, manager.id);
  await sales.createCallback(first.leadId!, manager.id, new Date("2026-09-14T08:15:00Z"), "Frontend progress", "NO_ANSWER");
  const before = await prisma.lead.findUniqueOrThrow({ where: { id: first.leadId! }, include: { callbacks: true, activities: true } });
  const countBefore = await prisma.notificationLog.count();
  const rerun = await seedSalesExpertDemo(prisma, { ...options, apply: true }, new Date("2026-09-11T16:00:00Z"));
  assert.equal(rerun.created, 0);
  assert.equal(rerun.preserved, 36);
  assert.deepEqual(await prisma.lead.findUniqueOrThrow({ where: { id: first.leadId! }, include: { callbacks: true, activities: true } }), before);
  assert.equal(await prisma.notificationLog.count(), countBefore);
  assert.equal(await prisma.studentPackage.count(), 1);

  // The compiled command derives its dates from its own launch time, without a date argument.
  const cliBefore = normalizeDemoOptions(options).startDate;
  const output = execFileSync(process.execPath, ["dist/src/prisma/seed/run-sales-expert-demo.js"], {
    env: { ...process.env, STAGING: "true" },
    encoding: "utf8",
  });
  const cliResult = JSON.parse(output.slice(0, output.lastIndexOf("}") + 1)) as { startDate: string; endDate: string; total: number };
  assert([cliBefore, normalizeDemoOptions(options).startDate].includes(cliResult.startDate));
  assert.equal(cliResult.endDate, demoScenarios(cliResult.startDate).at(-1)!.day);
  assert.equal(cliResult.total, 36);
  assert.equal(await prisma.lead.count(), 36, "CLI preview does not write");

  // Existing limited schedules must never be replaced to force four appointments in.
  const nextOptions = { apply: true };
  await prisma.expertSchedule.create({ data: { expertId: expert.id, dayOfWeek: 4, startMinute: 540, endMinute: 570 } });
  const schedulesBefore = await prisma.expertSchedule.count();
  await assert.rejects(seedSalesExpertDemo(prisma, nextOptions, demoTime("2026-10-01", 8 * 60)), /Not enough free slots/);
  assert.equal(await prisma.lead.count(), 36);
  assert.equal(await prisma.expertSchedule.count(), schedulesBefore);

  // A late first run creates completed historical appointments, never stale pending requests.
  const concurrent = await Promise.all([
    seedSalesExpertDemo(prisma, { apply: true }, demoTime("2026-11-06", 20 * 60)),
    seedSalesExpertDemo(prisma, { apply: true }, demoTime("2026-11-06", 20 * 60)),
  ]);
  assert.equal(
    concurrent.reduce((sum, run) => sum + run.created, 0),
    36,
    "Concurrent runs create exactly one batch",
  );
  const late = concurrent.find(run => run.created === 36)!;
  const todayCalls = await prisma.leadExpertCall.findMany({
    where: { leadId: { in: late.entries.filter(entry => entry.dayIndex === 0 && entry.kind === "consultation").map(entry => entry.leadId!) } },
  });
  assert.equal(todayCalls.length, 4);
  assert(todayCalls.every(call => call.status === "COMPLETED" && call.outcome === "FOLLOW_UP"));
  assert(late.entries.filter(entry => entry.dayIndex === 0 && entry.kind === "consultation").every(entry => entry.status === "RECALL"));

  // Force a failure after most of the batch has been written; all related data must roll back.
  const counts = async () => [
    await prisma.lead.count(),
    await prisma.user.count(),
    await prisma.contract.count(),
    await prisma.meeting.count(),
    await prisma.notificationLog.count(),
    await prisma.expertSchedule.count(),
  ];
  const beforeFailure = await counts();
  await prisma.$executeRawUnsafe(
    `CREATE FUNCTION demo_reject_last_lead() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."displayName" LIKE 'DEMO-S36 %' THEN RAISE EXCEPTION 'injected demo failure'; END IF; RETURN NEW; END; $$`,
  );
  await prisma.$executeRawUnsafe(`CREATE TRIGGER demo_reject_last BEFORE INSERT ON "Lead" FOR EACH ROW EXECUTE FUNCTION demo_reject_last_lead()`);
  try {
    await assert.rejects(seedSalesExpertDemo(prisma, { apply: true }, demoTime("2026-12-07", 8 * 60)), /injected demo failure/);
    assert.deepEqual(await counts(), beforeFailure);
  } finally {
    await prisma.$executeRawUnsafe(`DROP TRIGGER demo_reject_last ON "Lead"`);
    await prisma.$executeRawUnsafe(`DROP FUNCTION demo_reject_last_lead()`);
  }

  const otherManager = await prisma.user.create({
    data: { firstname: "Other", lastname: "Sales", email: "Sales.Other@example.test", password: "unused", role: { connect: { code: "SALES_MANAGER" } } },
  });
  const otherExpert = await prisma.user.create({
    data: {
      firstname: "Other",
      lastname: "Expert",
      email: "Expert.Other@example.test",
      password: "unused",
      role: { connect: { code: "EXPERT" } },
      consultantProfile: { create: {} },
    },
  });
  const customOptions = { ...options, apply: true, salesEmail: " SALES.OTHER@example.test ", expertEmail: "expert.other@example.test" };
  const originalLeads = await prisma.lead.findMany({ where: { id: { in: result.entries.map(entry => entry.leadId!) } }, orderBy: { id: "asc" } });
  const custom = await seedSalesExpertDemo(prisma, customOptions, now);
  assert.equal(custom.created, 36, "A different pair gets its own full batch on the same date");
  assert.equal(custom.accounts.sales.id, otherManager.id);
  assert.equal(custom.accounts.expert.id, otherExpert.id);
  const customIds = custom.entries.map(entry => entry.leadId!);
  const customLeads = await prisma.lead.findMany({ where: { id: { in: customIds } } });
  assert.equal(customLeads.filter(lead => lead.assignedSalesManagerId === otherManager.id).length, 33);
  assert.equal(customLeads.filter(lead => lead.assignedExpertUserId === otherExpert.id).length, 24);
  assert(customLeads.every(lead => lead.assignedSalesManagerId === null || lead.assignedSalesManagerId === otherManager.id));
  assert(customLeads.every(lead => lead.assignedExpertUserId === null || lead.assignedExpertUserId === otherExpert.id));
  assert.equal(
    await prisma.leadExpertCall.count({ where: { leadId: { in: customIds }, OR: [{ salesManagerId: { not: otherManager.id } }, { expertUserId: { not: otherExpert.id } }] } }),
    0,
  );
  assert.deepEqual(await prisma.lead.findMany({ where: { id: { in: result.entries.map(entry => entry.leadId!) } }, orderBy: { id: "asc" } }), originalLeads);

  await prisma.user.update({ where: { id: otherManager.id }, data: { email: "renamed-sales@example.test" } });
  const renamed = { ...customOptions, salesEmail: "renamed-sales@example.test" };
  assert.equal((await seedSalesExpertDemo(prisma, renamed, now)).created, 0, "Account IDs keep a batch stable after renaming an email");
  const explicitOutput = execFileSync(
    process.execPath,
    ["dist/src/prisma/seed/run-sales-expert-demo.js", "--sales-email=renamed-sales@example.test", "--expert-email=expert.other@example.test"],
    { env: { ...process.env, STAGING: "true" }, encoding: "utf8" },
  );
  assert(explicitOutput.includes('"total": 36'));
  assert(explicitOutput.includes('"email": "renamed-sales@example.test"'));
  const unchangedCounts = await counts();
  await assert.rejects(seedSalesExpertDemo(prisma, { ...renamed, salesEmail: "missing@example.test" }, now), /Active SALES_MANAGER required/);
  await assert.rejects(seedSalesExpertDemo(prisma, { ...renamed, salesEmail: renamed.expertEmail, expertEmail: renamed.salesEmail }, now), /Active SALES_MANAGER required/);
  assert.deepEqual(await counts(), unchangedCounts);

  const nextDay = await seedSalesExpertDemo(prisma, { apply: true }, demoTime("2026-09-12", 8 * 60));
  assert.equal(nextDay.created, 36, "A new launch day creates a new three-day batch without overwriting yesterday's progress");
  assert.equal(nextDay.startDate, "2026-09-12");
  assert.equal(nextDay.endDate, "2026-09-14");
  assert.deepEqual([...new Set(nextDay.entries.map(entry => entry.day))], ["2026-09-12", "2026-09-13", "2026-09-14"]);
  assert.deepEqual(await prisma.lead.findUniqueOrThrow({ where: { id: first.leadId! }, include: { callbacks: true, activities: true } }), before);
});
