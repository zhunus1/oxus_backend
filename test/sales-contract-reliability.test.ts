/** Real HTTP, PostgreSQL, Redis queues and two-server WebSocket regressions. Run after nest build. */
import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { EventEmitter } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { Server, type Socket } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { createClient } from "redis";
import { Queue, Worker } from "bullmq";
import { BullModule, getQueueToken } from "@nestjs/bullmq";
import { ScheduleModule, SchedulerRegistry } from "@nestjs/schedule";
import { MODULE_METADATA } from "@nestjs/common/constants";
import { Test } from "@nestjs/testing";
import { JwtService } from "@nestjs/jwt";
import { Reflector } from "@nestjs/core";
import { Logger, ValidationPipe, type INestApplication } from "@nestjs/common";
import request from "supertest";
import { useContainer } from "class-validator";
import type { PrismaService as PrismaServiceType } from "../src/database/prisma.service";

const built = createRequire(resolve("package.json"));
const klass = (path: string, name: string) => built(`./dist/src/${path}.js`)[name];
const PrismaService = klass("database/prisma.service", "PrismaService");
const ContractRepository = klass("modules/contract/repository/contract.repository", "ContractRepository");
const ContractService = klass("modules/contract/service/contract.service", "ContractService");
const AppModule = klass("app.module", "AppModule");
const MailService = klass("modules/mail/mail.service", "MailService");
const PdfService = klass("modules/contract/service/pdf.service", "PdfService");
const ContractNotificationProcessor = klass("modules/contract/service/contract-notification.service", "ContractNotificationProcessor");
const ContractNotificationService = klass("modules/contract/service/contract-notification.service", "ContractNotificationService");
const ExpertContractController = klass("modules/contract/api/expert-contract.controller", "ExpertContractController");
const LeadController = klass("modules/lead/api/lead.controller", "LeadController");
const LeadService = klass("modules/lead/service/lead.service", "LeadService");
const LeadRepository = klass("modules/lead/repository/lead.repository", "LeadRepository");
const LeadIngestionRepository = klass("modules/lead/repository/lead-ingestion.repository", "LeadIngestionRepository");
const LeadIngestionService = klass("modules/lead/service/lead-ingestion.service", "LeadIngestionService");
const LandingCalculatorAdapter = klass("modules/lead/service/landing-calculator.adapter", "LandingCalculatorAdapter");
const OfficeManualAdapter = klass("modules/lead/service/office-manual.adapter", "OfficeManualAdapter");
const LegacyContactFormAdapter = klass("modules/lead/service/legacy-contact-form.adapter", "LegacyContactFormAdapter");
const LeadRealtimeGateway = klass("modules/lead/realtime/lead-realtime.gateway", "LeadRealtimeGateway");
const AdminController = klass("modules/admin/admin.controller", "AdminController");
const AdminService = klass("modules/admin/admin.service", "AdminService");
const FinanceService = klass("modules/admin/finance.service", "FinanceService");
const JwtAuthGuard = klass("modules/admin/auth/rbac/auth.guard", "JwtAuthGuard");
const ExistsValidator = klass("common/validators/exists.validator", "ExistsValidator");
const RolesGuard = klass("modules/admin/auth/rbac/roles.guard", "RolesGuard");
const databaseUrl = new URL(process.env.DATABASE_URL ?? "");
const redisUrl = new URL(process.env.SALES_V2_TEST_REDIS_URL ?? "");
assert(["localhost", "127.0.0.1"].includes(databaseUrl.hostname) && databaseUrl.pathname.endsWith("_test"), "Use a disposable local *_test database");
assert(["localhost", "127.0.0.1"].includes(redisUrl.hostname) && redisUrl.protocol === "redis:", "Use disposable local SALES_V2_TEST_REDIS_URL");
const connection = { host: redisUrl.hostname, port: Number(redisUrl.port || 6379), retryStrategy: () => null };
const prisma: PrismaServiceType = new PrismaService();
const jwt = new JwtService();
const runId = randomUUID();
const originalSecret = process.env.JWT_SECRET;
const secret = randomUUID();
const queue = new Queue(`contract-reliability-${runId}`, { connection });
const gateways = [new LeadRealtimeGateway(jwt, prisma), new LeadRealtimeGateway(jwt, prisma)];
const servers: Server[] = [];
const redisClients: ReturnType<typeof createClient>[] = [];
const ports: number[] = [];
const authorizationEvents = new EventEmitter();
const clients: WebSocket[] = [];
const repo = Object.assign(new ContractRepository(), { prisma });
let app: INestApplication;
let admin: number, expert: number, sales: number;
let seq = 0;
let failMail = false,
  failPdf = false;
const sent: string[] = [];
const mail = {
  sendMail: async (email: string) => {
    if (failMail) throw new Error("Simulated SMTP outage");
    sent.push(email);
  },
};
const pdf = {
  generatePdf: async () => {
    if (failPdf) throw new Error("Simulated PDF outage");
    return Buffer.from("test PDF");
  },
};
const notifications = new ContractNotificationService(prisma, queue, mail, pdf);

/** Bounds transport assertions without relying on arbitrary sleeps. */
async function within<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Test timed out")), 8000);
      }),
    ]);
  } finally {
    clearTimeout(timer!);
  }
}
async function until(check: () => Promise<boolean>) {
  await within(
    (async () => {
      while (!(await check())) await delay(20);
    })(),
  );
}
async function user(role: string) {
  return prisma.user.create({
    data: { email: `${runId}-${++seq}@example.test`, firstname: "Reliability", lastname: "Fixture", password: "unused", role: { connect: { code: role } } },
  });
}
function auth(id: number) {
  return `Bearer ${jwt.sign({ sub: id }, { secret, expiresIn: 60 })}`;
}
async function fixture(crm = true) {
  const student = await user("STUDENT");
  const contract = await prisma.contract.create({
    data: {
      studentId: student.id,
      contractNumber: `${runId}-${++seq}`,
      status: "PENDING_EXPERT",
      subscriptionTier: "EXPERT_MENTORSHIP",
      price: 100000,
      currency: "KZT",
      serviceStartDate: new Date("2026-10-01Z"),
      serviceEndDate: new Date("2027-10-01Z"),
    },
  });
  if (crm) {
    await prisma.studentPortrait.create({ data: { userId: student.id } });
    await prisma.lead.create({ data: { status: "CONTRACT_PENDING", contractId: contract.id, assignedSalesManagerId: sales, assignedExpertUserId: expert } });
  }
  return { student, contract };
}
async function emailRows(contractId: string) {
  return prisma.notificationLog.findMany({ where: { channel: "EMAIL", metadata: { path: ["contractId"], equals: contractId } }, orderBy: { id: "asc" } });
}
async function connectSales(id: number, serverIndex = 0) {
  const authorized = new Promise<Socket>(resolve => authorizationEvents.once(String(serverIndex), resolve));
  const packets: string[] = [];
  const ws = new WebSocket(`ws://127.0.0.1:${ports[serverIndex]}/socket.io/?EIO=4&transport=websocket`);
  clients.push(ws);
  ws.addEventListener("message", event => {
    const packet = String(event.data);
    packets.push(packet);
    if (packet.startsWith("0")) ws.send(`40/sales,${JSON.stringify({ token: auth(id).slice(7) })}`);
    if (packet === "2") ws.send("3");
  });
  const socket = await within(authorized);
  return { ws, packets, socket };
}

before(async () => {
  Logger.overrideLogger(false);
  process.env.JWT_SECRET = secret;
  await prisma.$connect();
  for (const code of ["ADMIN", "EXPERT", "SALES_MANAGER", "STUDENT"]) await prisma.role.upsert({ where: { code }, create: { code, name: code }, update: {} });
  admin = (await user("ADMIN")).id;
  expert = (await user("EXPERT")).id;
  sales = (await user("SALES_MANAGER")).id;
  await prisma.consultantProfile.create({ data: { userId: expert, isActive: true } });
  for (const gateway of gateways) {
    const pub = createClient({ url: redisUrl.toString() }),
      sub = pub.duplicate();
    redisClients.push(pub, sub);
    await Promise.all([pub.connect(), sub.connect()]);
    const http = createServer();
    const io = new Server(http, { adapter: createAdapter(pub, sub, { key: runId }) });
    servers.push(io);
    const ns = io.of("/sales");
    gateway.server = ns;
    ns.on("connection", socket => {
      socket.on("disconnect", () => gateway.handleDisconnect(socket));
      void gateway.handleConnection(socket).then(() => {
        authorizationEvents.emit(String(gateways.indexOf(gateway)), socket);
      });
    });
    await new Promise<void>(resolve => http.listen(0, "127.0.0.1", resolve));
    ports.push((http.address() as AddressInfo).port);
  }
  const ingestion = new LeadIngestionService(new LeadIngestionRepository(prisma), new LandingCalculatorAdapter(), new OfficeManualAdapter(), new LegacyContactFormAdapter());
  // Suppress only the eager wake to test a crash between database commit and dispatch; scheduled recovery remains real.
  const service = new ContractService(repo, {}, { enqueue() {} }, {}, { logEvent: async () => {} }, gateways[0]);
  const module = await Test.createTestingModule({
    controllers: [ExpertContractController, LeadController, AdminController],
    providers: [
      { provide: ContractService, useValue: service },
      { provide: LeadService, useValue: new LeadService(Object.assign(new LeadRepository(), { prisma }), ingestion, gateways[0]) },
      { provide: ExistsValidator, useValue: new ExistsValidator(prisma) },
      { provide: PrismaService, useValue: prisma },
      { provide: LeadRealtimeGateway, useValue: gateways[0] },
      { provide: FinanceService, useValue: {} },
      { provide: AdminService, useValue: new AdminService(prisma, {}, {}, gateways[0]) },
    ],
  })
    .overrideGuard(JwtAuthGuard)
    .useValue(new JwtAuthGuard(new Reflector(), jwt, prisma))
    .overrideGuard(RolesGuard)
    .useValue(new RolesGuard(new Reflector()))
    .compile();
  useContainer(module, { fallbackOnErrors: true });
  app = module.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  await app.init();
});
after(async () => {
  clients.forEach(client => client.close());
  gateways.forEach(gateway => gateway.onModuleDestroy());
  for (const server of servers)
    await new Promise<void>(resolve => {
      void server.close(() => resolve());
    });
  for (const client of redisClients) if (client.isOpen) await client.quit();
  await queue.obliterate({ force: true });
  await queue.close();
  await app?.close();
  await prisma.$disconnect();
  if (originalSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalSecret;
});

test("blocking through HTTP revokes Sales sockets on both servers and prevents reconnection", async () => {
  const target = await user("SALES_MANAGER");
  const a = await connectSales(target.id, 0),
    b = await connectSales(target.id, 1),
    unaffected = await connectSales(sales, 1);
  assert(a.socket.rooms.has("sales:unassigned"));
  assert(b.socket.rooms.has("sales:unassigned"));
  const disconnected = Promise.all([a, b].map(({ socket }) => new Promise<void>(resolve => socket.once("disconnect", () => resolve()))));
  await request(app.getHttpServer()).patch(`/admin/users/${target.id}/block`).set("Authorization", auth(admin)).send({}).expect(200);
  await within(disconnected);
  assert(unaffected.socket.connected);
  gateways[0].emitLeadCreated({ id: 987, phone: "+77770000000" });
  await until(async () => unaffected.packets.some(packet => packet.includes('"id":987')));
  assert(!a.packets.some(packet => packet.includes('"id":987')));
  assert(!b.packets.some(packet => packet.includes('"id":987')));
  const reconnect = await connectSales(target.id, 1);
  assert(!reconnect.socket.connected);
  await request(app.getHttpServer()).get(`/contracts?status=PENDING_EXPERT`).set("Authorization", auth(target.id)).expect(401);
});

test("role change through HTTP revokes old Sales rooms across servers", async () => {
  const target = await user("SALES_MANAGER"),
    connected = await connectSales(target.id, 1);
  const role = await prisma.role.findUniqueOrThrow({ where: { code: "EXPERT" } });
  const disconnected = new Promise<void>(resolve => connected.socket.once("disconnect", () => resolve()));
  await request(app.getHttpServer()).patch(`/admin/users/${target.id}`).set("Authorization", auth(admin)).send({ roleId: role.id }).expect(200);
  await within(disconnected);
  const replacement = await connectSales(target.id, 1);
  assert(replacement.socket.rooms.has(`expert:user:${target.id}`));
  assert(!replacement.socket.rooms.has("sales:unassigned"));
});

test("legacy contact form emits creation and counter events once after persistence", async () => {
  const connected = await connectSales(sales);
  const response = await request(app.getHttpServer())
    .post("/leads")
    .send({
      firstName: "Legacy",
      lastName: "Fixture",
      phone: "+77770112244",
      email: `${runId}-legacy@example.test`,
      topic: "Admission",
      interests: "Study",
      role: "student",
      preferredLanguage: "ru",
    })
    .expect(201);
  assert.equal((await prisma.lead.findUniqueOrThrow({ where: { id: response.body.id } })).status, "NEW");
  await until(async () => connected.packets.some(packet => packet.includes('"lead.summary.updated"')));
  assert.equal(connected.packets.filter(packet => packet.includes('"lead.created",')).length, 1);
  assert.equal(connected.packets.filter(packet => packet.includes('"lead.summary.updated",')).length, 1);
  assert(connected.packets.some(packet => packet.includes(`"id":${response.body.id}`)));
});

for (const crm of [true, false]) {
  test(`partial contract dates are validated against stored dates (${crm ? "CRM" : "legacy"})`, async () => {
    const { contract } = await fixture(crm);
    const patch = (body: object) => request(app.getHttpServer()).patch(`/contracts/${contract.id}/meta`).set("Authorization", auth(expert)).send(body);
    await patch({ serviceEndDate: "2026-09-01T00:00:00Z" }).expect(400);
    await patch({ serviceStartDate: "2027-11-01T00:00:00Z" }).expect(400);
    await patch({ serviceEndDate: "2026-10-01T00:00:00Z" }).expect(400);
    const stored = await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } });
    assert.equal(+stored.serviceStartDate!, +contract.serviceStartDate!);
    assert.equal(+stored.serviceEndDate!, +contract.serviceEndDate!);
    await patch({ serviceStartDate: "2028-01-01T00:00:00Z", serviceEndDate: "2029-01-01T00:00:00Z" }).expect(200);
    await patch({ price: 200000 }).expect(200);
  });
}

test("concurrent individually valid partial date updates cannot commit an invalid pair", async () => {
  const { contract } = await fixture();
  const results = await Promise.allSettled([
    repo.updateMeta(contract.id, { serviceStartDate: new Date("2027-06-01Z") }),
    repo.updateMeta(contract.id, { serviceEndDate: new Date("2027-01-01Z") }),
  ]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  const stored = await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } });
  assert(stored.serviceEndDate! > stored.serviceStartDate!);
});

test("expert signing persists exactly one email intent and returns queued, not delivered", async () => {
  const { contract } = await fixture();
  const sign = () => request(app.getHttpServer()).post(`/contracts/${contract.id}/sign/expert`).set("Authorization", auth(expert)).send({});
  const response = await sign().expect(201);
  assert.match(response.body.message, /queued/);
  assert(!response.body.message.includes("notified"));
  await sign().expect(400);
  const rows = await emailRows(contract.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "PENDING");
  assert.equal(rows[0].type, "CONTRACT_READY");
});

test("SMTP failure survives a worker restart and queue loss, then recovers from PostgreSQL", async () => {
  const { contract, student } = await fixture();
  await repo.expertSign(contract.id, expert);
  const [intent] = await emailRows(contract.id);
  failMail = true;
  const worker = new Worker(queue.name, job => notifications.deliver(job.data.notificationId), { connection });
  try {
    const failed = new Promise<void>(resolve =>
      worker.on("failed", job => {
        if (job?.data.notificationId === intent.id) resolve();
      }),
    );
    await queue.add("deliver", { notificationId: intent.id }, { jobId: `contract-email-${intent.id}`, attempts: 1, removeOnFail: true });
    await within(failed);
  } finally {
    await worker.close();
    failMail = false;
  }
  assert.equal((await prisma.notificationLog.findUniqueOrThrow({ where: { id: intent.id } })).status, "PENDING");
  await queue.obliterate({ force: true });
  const restarted = new ContractNotificationService(prisma, queue, mail, pdf);
  await restarted.recover();
  const replacement = new Worker(queue.name, job => restarted.deliver(job.data.notificationId), { connection });
  try {
    await until(async () => (await prisma.notificationLog.findUniqueOrThrow({ where: { id: intent.id } })).status === "SENT");
  } finally {
    await replacement.close();
  }
  assert.equal(sent.filter(email => email === student.email).length, 1);
  await restarted.deliver(intent.id);
  assert.equal(sent.filter(email => email === student.email).length, 1);
  assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } })).status, "PENDING_STUDENT");
});

test("mail-intent failure rolls back the expert signature", async () => {
  const { contract } = await fixture();
  const failing = prisma.$extends({
    query: {
      notificationLog: {
        createMany: async () => {
          throw new Error("Outbox unavailable");
        },
      },
    },
  });
  const failingRepo = Object.assign(new ContractRepository(), { prisma: failing });
  await assert.rejects(failingRepo.expertSign(contract.id, expert), /Outbox unavailable/);
  assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } })).status, "PENDING_EXPERT");
  assert.equal((await emailRows(contract.id)).length, 0);
});

test("signed PDF retries independently for each recipient without granting benefits again", async () => {
  const { contract, student } = await fixture();
  await repo.expertSign(contract.id, expert);
  await repo.studentSign(contract.id, { clientFullName: "Client", studentName: "Student", clientIin: "000000000000", clientAddress: "Test", clientPhone: "+77770000000" });
  const rows = await emailRows(contract.id),
    ready = rows.find(row => row.type === "CONTRACT_READY")!,
    copies = rows.filter(row => row.type === "CONTRACT_SIGNED_COPY");
  assert.equal(copies.length, 2);
  await notifications.deliver(ready.id);
  assert.equal((await prisma.notificationLog.findUniqueOrThrow({ where: { id: ready.id } })).status, "CANCELLED");
  const benefits = await prisma.studentPackage.findFirstOrThrow({ where: { studentId: student.id } });
  failPdf = true;
  await assert.rejects(notifications.deliver(copies[0].id), /PDF outage/);
  failPdf = false;
  await notifications.deliver(copies[0].id);
  failMail = true;
  await assert.rejects(notifications.deliver(copies[1].id), /SMTP outage/);
  failMail = false;
  assert.equal((await prisma.notificationLog.findUniqueOrThrow({ where: { id: copies[0].id } })).status, "SENT");
  assert.equal((await prisma.notificationLog.findUniqueOrThrow({ where: { id: copies[1].id } })).status, "PENDING");
  await notifications.deliver(copies[1].id);
  await notifications.deliver(copies[0].id);
  assert.equal(sent.filter(email => email === student.email).length, 1);
  assert.equal((await prisma.studentPackage.findUniqueOrThrow({ where: { id: benefits.id } })).totalSlots, benefits.totalSlots);
});

test("concurrent legacy signatures do not create duplicate delivery intents", async () => {
  const { contract } = await fixture(false);
  const results = await Promise.allSettled([repo.expertSign(contract.id, expert), repo.expertSign(contract.id, expert)]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal((await emailRows(contract.id)).length, 1);
});

test("Nest startup registers contract recovery and the real processor delivers committed mail", async () => {
  const { contract, student } = await fixture();
  await repo.expertSign(contract.id, expert);
  const [intent] = await emailRows(contract.id);
  const schedulers = Reflect.getMetadata(MODULE_METADATA.IMPORTS, AppModule).filter((entry: { module?: unknown }) => entry?.module === ScheduleModule);
  const module = await Test.createTestingModule({
    imports: [...schedulers, BullModule.forRoot({ connection, prefix: `nest-reliability-${runId}` }), BullModule.registerQueue({ name: "contract-notifications" })],
    providers: [
      ContractNotificationService,
      ContractNotificationProcessor,
      { provide: PrismaService, useValue: prisma },
      { provide: MailService, useValue: mail },
      { provide: PdfService, useValue: pdf },
    ],
  }).compile();
  const registeredQueue: Queue = module.get(getQueueToken("contract-notifications"));
  try {
    await module.init();
    assert.equal(module.get(SchedulerRegistry).getCronJobs().size, 1);
    await until(async () => (await prisma.notificationLog.findUniqueOrThrow({ where: { id: intent.id } })).status === "SENT");
    assert.equal(sent.filter(email => email === student.email).length, 1);
  } finally {
    await module.get(ContractNotificationService).recover();
    await module.get(ContractNotificationProcessor).worker.close();
    await registeredQueue.obliterate({ force: true });
    await module.close();
  }
});
