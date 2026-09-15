/** Requires nest build and a disposable local *_test PostgreSQL database. Sends no real mail. */
import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { before, after, test } from "node:test";
import { Logger } from "@nestjs/common";

const built = createRequire(resolve(process.cwd(), "package.json"));
const { PrismaService } = built("./dist/src/database/prisma.service.js");
const { LeadExpertCallService } = built("./dist/src/modules/lead/service/lead-expert-call.service.js");
const { LeadCallNotificationService } = built("./dist/src/modules/lead/service/lead-call-notification.service.js");
const { scheduleLeadCallNotifications } = built("./dist/src/modules/lead/domain/lead-call-notifications.js");
const databaseUrl = new URL(process.env.DATABASE_URL ?? "");
assert(["localhost", "127.0.0.1"].includes(databaseUrl.hostname) && databaseUrl.pathname.endsWith("_test"), "Use a disposable local *_test database");
const prisma = new PrismaService();
const calls = new LeadExpertCallService(prisma, {
  emitExpertLeadUpdated() {},
  emitExpertCallRequested() {},
  emitNotification() {},
  emitLeadUpdated() {},
  emitExpertCallUpdated() {},
  emitExpertCallRemoved() {},
});
let managerId: number;
const runId = randomUUID();
let sequence = 0;
async function user(role: string) {
  return prisma.user.create({
    data: { email: `${runId}-${++sequence}@example.test`, firstname: "Test", lastname: "Expert", password: "test-only", timezone: "UTC", role: { connect: { code: role } } },
  });
}
async function book() {
  const expert = await user("EXPERT");
  await prisma.consultantProfile.create({ data: { userId: expert.id, isActive: true } });
  await prisma.expertSchedule.createMany({ data: Array.from({ length: 7 }, (_, index) => ({ expertId: expert.id, dayOfWeek: index + 1, startMinute: 0, endMinute: 1440 })) });
  const lead = await prisma.lead.create({ data: { displayName: "Иван Петров", assignedSalesManagerId: managerId } });
  const startTime = new Date();
  startTime.setUTCDate(startTime.getUTCDate() + 2);
  startTime.setUTCHours(10, 0, 0, 0);
  const call = await calls.create(managerId, lead.id, { expertUserId: expert.id, startTime: startTime.toISOString(), endTime: new Date(+startTime + 1800_000).toISOString() });
  const notifications = await prisma.notificationLog.findMany({ where: { leadId: lead.id, channel: "EMAIL" }, orderBy: { id: "asc" } });
  return { expert, lead, call, assigned: notifications[0], reminder: notifications[1] };
}
function worker(sendMail: (...args: any[]) => Promise<any> = async () => {}) {
  return new LeadCallNotificationService(prisma, { add: async () => {} }, { sendMail });
}
async function imminent(fixture: Awaited<ReturnType<typeof book>>, status = "CONFIRMED") {
  const startTime = new Date(Date.now() + 300_000);
  const endTime = new Date(+startTime + 1800_000);
  await prisma.leadExpertCall.update({ where: { id: fixture.call.id }, data: { startTime, endTime, status } });
  await prisma.notificationLog.update({
    where: { id: fixture.reminder.id },
    data: { scheduledFor: new Date(Date.now() - 1000), metadata: { callId: fixture.call.id, startTime: startTime.toISOString(), endTime: endTime.toISOString() } },
  });
}
before(async () => {
  Logger.overrideLogger(false);
  await prisma.$connect();
  for (const code of ["SALES_MANAGER", "EXPERT"]) await prisma.role.upsert({ where: { code }, create: { code, name: code }, update: {} });
  managerId = (await user("SALES_MANAGER")).id;
});
after(async () => prisma.$disconnect());

test("booking commits exactly two email intents; duplicate planning is harmless and email uses the expert timezone", async () => {
  const f = await book();
  assert.equal(+f.reminder.scheduledFor, +f.call.startTime - 600_000);
  await prisma.$transaction(tx => scheduleLeadCallNotifications(tx, f.call));
  assert.equal(await prisma.notificationLog.count({ where: { leadId: f.lead.id, channel: "EMAIL" } }), 2);
  await prisma.user.update({ where: { id: f.expert.id }, data: { timezone: "Asia/Almaty" } });
  const sent: any[] = [];
  const delivery = worker(async (...args) => {
    sent.push(args);
  });
  await delivery.deliver(f.assigned.id);
  await delivery.deliver(f.assigned.id);
  assert.equal(sent.length, 1);
  assert.equal(sent[0][0], f.expert.email);
  assert.match(sent[0][2], /Иван Петров.*15:00 \(Asia\/Almaty\)/);
  assert.equal((await prisma.notificationLog.findUniqueOrThrow({ where: { id: f.assigned.id } })).status, "SENT");
});

test("a transaction rollback leaves no scheduled email", async () => {
  const f = await book();
  await assert.rejects(
    prisma.$transaction(async tx => {
      await scheduleLeadCallNotifications(tx, { ...f.call, updatedAt: new Date(+f.call.updatedAt + 1000) });
      throw new Error("rollback");
    }),
  );
  assert.equal(await prisma.notificationLog.count({ where: { leadId: f.lead.id, channel: "EMAIL", status: "PENDING" } }), 2);
});

test("reminders wait for their due time and for confirmation, including a late confirmation", async () => {
  const f = await book();
  let sent = 0;
  const delivery = worker(async () => {
    sent++;
  });
  await delivery.deliver(f.reminder.id);
  assert.equal(sent, 0);
  await imminent(f, "REQUESTED");
  await delivery.deliver(f.reminder.id);
  assert.equal(sent, 0);
  assert.equal((await prisma.notificationLog.findUniqueOrThrow({ where: { id: f.reminder.id } })).deliveryAttempts, 0);
  await prisma.leadExpertCall.update({ where: { id: f.call.id }, data: { status: "CONFIRMED" } });
  await prisma.notificationLog.update({ where: { id: f.reminder.id }, data: { nextAttemptAt: new Date(0) } });
  await delivery.deliver(f.reminder.id);
  assert.equal(sent, 1);
});

test("cancelled, declined, completed, expired, reassigned, deleted and rescheduled calls send no stale reminder", async () => {
  for (const scenario of ["CANCELLED", "DECLINED", "COMPLETED", "expired", "reassigned", "deleted", "rescheduled", "expertDisabled"]) {
    const f = await book();
    await imminent(f);
    if (["CANCELLED", "DECLINED", "COMPLETED"].includes(scenario)) await prisma.leadExpertCall.update({ where: { id: f.call.id }, data: { status: scenario } });
    if (scenario === "expired") await prisma.leadExpertCall.update({ where: { id: f.call.id }, data: { startTime: new Date(0) } });
    if (scenario === "reassigned") await prisma.lead.update({ where: { id: f.lead.id }, data: { assignedExpertUserId: null } });
    if (scenario === "deleted") await prisma.lead.update({ where: { id: f.lead.id }, data: { deletedAt: new Date() } });
    if (scenario === "rescheduled") await prisma.leadExpertCall.update({ where: { id: f.call.id }, data: { startTime: new Date(Date.now() + 400_000) } });
    if (scenario === "expertDisabled") await prisma.user.update({ where: { id: f.expert.id }, data: { deletedAt: new Date() } });
    let sent = false;
    await worker(async () => {
      sent = true;
    }).deliver(f.reminder.id);
    assert.equal(sent, false, scenario);
    assert.equal((await prisma.notificationLog.findUniqueOrThrow({ where: { id: f.reminder.id } })).status, "CANCELLED", scenario);
  }
});

test("comment edits preserve notifications; rescheduling cancels old intents and schedules the new time", async () => {
  const f = await book();
  await calls.update(managerId, f.lead.id, f.call.id, { comment: "A comment" });
  assert.equal(await prisma.notificationLog.count({ where: { leadId: f.lead.id, channel: "EMAIL" } }), 2);
  await calls.update(managerId, f.lead.id, f.call.id, {
    startTime: new Date(+f.call.startTime + 3600_000).toISOString(),
    endTime: new Date(+f.call.endTime + 3600_000).toISOString(),
  });
  assert.equal(await prisma.notificationLog.count({ where: { leadId: f.lead.id, channel: "EMAIL", status: "CANCELLED" } }), 2);
  assert.equal(await prisma.notificationLog.count({ where: { leadId: f.lead.id, channel: "EMAIL", status: "PENDING" } }), 2);
});

test("concurrent workers claim one delivery; SMTP failures retry with a persisted limit", async () => {
  const f = await book();
  let sent = 0;
  const delivery = worker(async () => {
    sent++;
  });
  await Promise.all([delivery.deliver(f.assigned.id), delivery.deliver(f.assigned.id)]);
  assert.equal(sent, 1);
  const other = await book();
  const failing = worker(async () => {
    throw new Error("SMTP offline");
  });
  for (let attempt = 1; attempt <= 5; attempt++) {
    await failing.deliver(other.assigned.id);
    const row = await prisma.notificationLog.findUniqueOrThrow({ where: { id: other.assigned.id } });
    assert.equal(row.deliveryAttempts, attempt);
    assert.equal(row.status, attempt === 5 ? "FAILED" : "PENDING");
    if (attempt < 5) {
      assert(row.nextAttemptAt > new Date());
      await failing.deliver(other.assigned.id);
      assert.equal((await prisma.notificationLog.findUniqueOrThrow({ where: { id: other.assigned.id } })).deliveryAttempts, attempt);
      await prisma.notificationLog.update({ where: { id: other.assigned.id }, data: { nextAttemptAt: new Date(0) } });
    }
  }
  await delivery.deliver(other.assigned.id);
  assert.equal(sent, 1);
});

test("a stopped worker's expired lease recovers; an active lease and unrelated email are untouched", async () => {
  const f = await book();
  await prisma.notificationLog.update({ where: { id: f.assigned.id }, data: { status: "SENDING", deliveryLeaseUntil: new Date(Date.now() + 60_000) } });
  let sent = 0;
  const delivery = worker(async () => {
    sent++;
  });
  await delivery.deliver(f.assigned.id);
  assert.equal(sent, 0);
  await prisma.notificationLog.update({ where: { id: f.assigned.id }, data: { deliveryLeaseUntil: new Date(0) } });
  await delivery.deliver(f.assigned.id);
  assert.equal(sent, 1);
  const contract = await prisma.notificationLog.create({
    data: { userId: f.expert.id, channel: "EMAIL", type: "CONTRACT_READY", status: "PENDING", content: "", scheduledFor: new Date(0) },
  });
  await delivery.deliver(contract.id);
  assert.equal(sent, 1);
  assert.equal((await prisma.notificationLog.findUniqueOrThrow({ where: { id: contract.id } })).status, "PENDING");
});

test("queue failure leaves committed mail recoverable in a new service instance", async () => {
  const f = await book();
  await new LeadCallNotificationService(
    prisma,
    {
      add: async () => {
        throw new Error("Redis offline");
      },
    },
    {},
  ).recover();
  assert.equal((await prisma.notificationLog.findUniqueOrThrow({ where: { id: f.assigned.id } })).status, "PENDING");
  const queued: number[] = [];
  await new LeadCallNotificationService(
    prisma,
    {
      add: async (_name, data) => {
        queued.push(data.notificationId);
      },
    },
    {},
  ).recover();
  assert(queued.includes(f.assigned.id));
  assert(!queued.includes(f.reminder.id));
});

test("a transient database read failure releases the delivery lease for a timely retry", async () => {
  const f = await book();
  const failedRead = new LeadCallNotificationService(
    {
      notificationLog: {
        updateMany: args => prisma.notificationLog.updateMany(args),
        findUniqueOrThrow: async () => {
          throw new Error("Database temporarily unavailable");
        },
      },
    },
    {},
    {},
  );
  await assert.rejects(failedRead.deliver(f.assigned.id), /Database temporarily unavailable/);
  const row = await prisma.notificationLog.findUniqueOrThrow({ where: { id: f.assigned.id } });
  assert.equal(row.status, "PENDING");
  assert.equal(row.deliveryLeaseUntil, null);
  assert.equal(row.deliveryAttempts, 0);
  assert(row.nextAttemptAt > new Date());
});
