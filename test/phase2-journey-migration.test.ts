import "reflect-metadata";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Client } from "pg";
import { PrismaService } from "../src/database/prisma.service";

test("F08 migration: confirmed historical receipts are backfilled once without changing original events or drafts", async () => {
  const url = new URL(process.env.DATABASE_URL ?? "");
  assert(["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname.endsWith("_test"), "Use a disposable local *_test database");
  const prisma = new PrismaService();
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  try {
    await prisma.role.upsert({ where: { code: "STUDENT" }, create: { code: "STUDENT", name: "Student" }, update: {} });
    const student = await prisma.user.create({
      data: { firstname: "Migration", lastname: "Fixture", email: `${randomUUID()}@example.test`, password: "unused", role: { connect: { code: "STUDENT" } } },
    });
    const signedAt = new Date("2025-01-01T10:00:00Z");
    const paidAt = new Date("2025-01-02T10:00:00Z");
    const secondAt = new Date("2025-02-02T10:00:00Z");
    const c = await prisma.contract.create({
      data: {
        studentId: student.id,
        contractNumber: randomUUID(),
        subscriptionTier: "EXPERT_MENTORSHIP",
        price: 1500000,
        currency: "KZT",
        status: "SIGNED",
        studentSignedAt: signedAt,
        manualConfirmedAt: paidAt,
        paymentType: "INSTALLMENT",
        installmentCount: 3,
        installments: {
          create: [
            { number: 1, amount: 500000, dueDate: paidAt, paidAt },
            { number: 2, amount: 500000, dueDate: secondAt, paidAt: secondAt },
            { number: 3, amount: 500000, dueDate: new Date("2025-03-02T00:00:00Z") },
          ],
        },
      },
    });
    await prisma.lead.create({ data: { status: "CONVERTED", convertedAt: paidAt, contractId: c.id } });
    await prisma.lead.create({ data: { status: "CONTRACT_PENDING", contractDraft: { create: { data: {}, signedAt } } } });
    const existing = await prisma.userJourneyEvent.create({ data: { userId: student.id, eventType: "CONTRACT_SIGNED", createdAt: signedAt, eventData: { legacy: true } } });
    const sql = await readFile("src/prisma/migrations/20260928151000_backfill_manual_journey/migration.sql", "utf8");
    await client.query(sql);
    const first = await prisma.userJourneyEvent.findMany({ orderBy: { id: "asc" } });
    await client.query(sql);
    assert.deepEqual(await prisma.userJourneyEvent.findMany({ orderBy: { id: "asc" } }), first);
    assert.equal(first.length, 4);
    assert.deepEqual(
      first.find(e => e.id === existing.id),
      existing,
    );
    assert.equal(+first.find(e => e.eventType === "PAYMENT_COMPLETED")!.occurredAt!, +paidAt);
    assert.equal(+first.find(e => e.eventType === "CONTRACT_INSTALLMENT_PAID")!.occurredAt!, +secondAt);
    assert.equal(+first.find(e => e.eventType === "LEAD_CONVERTED")!.occurredAt!, +paidAt);
    assert(first.filter(e => e.id !== existing.id).every(e => e.createdAt > e.occurredAt!));
    assert.equal(await prisma.user.count(), 1);
    assert.equal(await prisma.contract.count(), 1);
  } finally {
    await client.end();
    await prisma.$disconnect();
  }
});
