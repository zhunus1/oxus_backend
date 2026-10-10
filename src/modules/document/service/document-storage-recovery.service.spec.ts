import { Logger } from "@nestjs/common";
import { DocumentStorageRecoveryService, type DocumentStorageIntent } from "./document-storage-recovery.service";
import { PrismaService } from "src/database/prisma.service";
import { AuditLogService } from "src/modules/audit-log/service/audit-log.service";
import { StudentDocumentStorageService } from "src/common/utils/minio/student-document-storage.service";

jest.mock("src/database/prisma.service", () => ({ PrismaService: class {} }));
jest.mock("generated/prisma/client", () => ({ Prisma: {} }));

describe("private document durable compensation", () => {
  const intent: DocumentStorageIntent = {
    id: 1,
    details: { fileKey: "documents/00000000-0000-4000-8000-000000000001", operationId: "operation", studentPortraitId: 2, ownerUserId: 3, documentId: null, state: "PENDING" },
  };
  let db: { document: { count: jest.Mock }; auditLog: { update: jest.Mock; findUnique: jest.Mock } };
  let remove: jest.Mock;
  let recovery: DocumentStorageRecoveryService;
  beforeEach(() => {
    db = {
      document: { count: jest.fn().mockResolvedValue(0) },
      auditLog: { update: jest.fn().mockResolvedValue({}), findUnique: jest.fn().mockResolvedValue({ details: intent.details }) },
    };
    remove = jest.fn().mockResolvedValue(undefined);
    recovery = new DocumentStorageRecoveryService(
      db as unknown as PrismaService,
      {} as AuditLogService,
      { deletePrivateDocument: remove } as unknown as StudentDocumentStorageService,
    );
    jest.spyOn(Logger.prototype, "warn").mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  it("never deletes or guesses rollback when COMMIT outcome is unknown", async () => {
    await recovery.compensate(intent, false);
    expect(db.document.count).not.toHaveBeenCalled();
    expect(db.auditLog.update).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });
  it("checks all references including archived documents before deleting a proven rolled-back key", async () => {
    await recovery.compensate(intent, true);
    expect(db.document.count).toHaveBeenCalledWith({ where: { fileKey: intent.details.fileKey } });
    expect(remove).toHaveBeenCalledWith(intent.details.fileKey, expect.any(AbortSignal));
    expect(db.auditLog.update.mock.calls.map(([args]) => args.data.details.state)).toEqual(["ROLLED_BACK", "CLEANED"]);
  });
  it("retains referenced keys on proven rollback", async () => {
    db.document.count.mockResolvedValue(1);
    await recovery.compensate(intent, true);
    expect(remove).not.toHaveBeenCalled();
    expect(db.auditLog.update).not.toHaveBeenCalled();
  });
  it.each(["COMMITTED", "CLEANED"])("does not compensate durable %s operations", async state => {
    db.auditLog.findUnique.mockResolvedValue({ details: { ...intent.details, state } });
    await recovery.compensate(intent, true);
    expect(remove).not.toHaveBeenCalled();
  });
  it("retains bytes if database reference inspection fails", async () => {
    db.document.count.mockRejectedValue(new Error("database unavailable"));
    await recovery.compensate(intent, true);
    expect(remove).not.toHaveBeenCalled();
  });
  it("keeps a durable ROLLED_BACK intent when cleanup fails", async () => {
    remove.mockRejectedValue(new Error("storage unavailable"));
    await recovery.compensate(intent, true);
    expect(db.auditLog.update).toHaveBeenCalledTimes(1);
    expect(db.auditLog.update.mock.calls[0][0].data.details.state).toBe("ROLLED_BACK");
  });
  it("does not delete when journaling a rollback fails", async () => {
    db.auditLog.update.mockRejectedValue(new Error("journal unavailable"));
    await recovery.compensate(intent, true);
    expect(remove).not.toHaveBeenCalled();
  });

  it("creates intents in the internal namespace before returning their identity", async () => {
    const log = jest.fn().mockResolvedValue({ id: 4 });
    const service = new DocumentStorageRecoveryService(db as unknown as PrismaService, { log } as unknown as AuditLogService, {} as StudentDocumentStorageService);
    await expect(service.begin(3, intent.details)).resolves.toEqual({ id: 4, details: intent.details });
    expect(log).toHaveBeenCalledWith(3, "DOCUMENT_STORAGE_PENDING", "DocumentStorageIntent", 2, intent.details);
  });

  it("binds journal reads and every state transition to namespace/action/key/operation identity", async () => {
    await recovery.compensate(intent, true);
    const filters = [db.auditLog.findUnique.mock.calls[0][0].where, ...db.auditLog.update.mock.calls.map(([args]) => args.where)];
    for (const where of filters) {
      expect(where).toMatchObject({ id: 1, action: "DOCUMENT_STORAGE_PENDING", entityId: 2, OR: [{ entityType: "DocumentStorageIntent" }, { entityType: "StudentPortrait" }] });
      expect(where.AND).toEqual(
        expect.arrayContaining([{ details: { path: ["fileKey"], equals: intent.details.fileKey } }, { details: { path: ["operationId"], equals: "operation" } }]),
      );
    }
  });

  it("never compensates a different operation with the same key", async () => {
    db.auditLog.findUnique.mockResolvedValue({ details: { ...intent.details, operationId: "different" } });
    await recovery.compensate(intent, true);
    expect(db.document.count).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });
});
