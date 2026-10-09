import { ForbiddenException } from "@nestjs/common";
import type { PrismaService } from "src/database/prisma.service";
import { StudentDocumentAccessService } from "./student-document-access.service";

jest.mock("src/database/prisma.service", () => ({ PrismaService: class {} }));

describe("Student document access policy", () => {
  const user = { findUnique: jest.fn() };
  const studentPortrait = { findFirst: jest.fn() };
  const targetProgram = { findFirst: jest.fn() };
  const db = { user, studentPortrait, targetProgram } as unknown as PrismaService;
  const policy = new StudentDocumentAccessService(db);
  function actor(code: string, active = true) {
    return { deletedAt: null, role: { code, deletedAt: null }, consultantProfile: { isActive: active } };
  }
  beforeEach(() => {
    jest.resetAllMocks();
    studentPortrait.findFirst.mockResolvedValue({ id: 29 });
    targetProgram.findFirst.mockResolvedValue({ id: 7 });
  });

  it.each(["STUDENT", "SCHOOLBOY"])("allows %s only through portrait.userId", async role => {
    user.findUnique.mockResolvedValue(actor(role));
    await policy.assertPortrait(73, 29);
    expect(studentPortrait.findFirst).toHaveBeenCalledWith({ where: { id: 29, userId: 73 }, select: { id: true } });
  });
  it("denies a student's foreign portrait", async () => {
    user.findUnique.mockResolvedValue(actor("STUDENT"));
    studentPortrait.findFirst.mockResolvedValue(null);
    await expect(policy.assertPortrait(73, 29)).rejects.toBeInstanceOf(ForbiddenException);
  });
  it("compares assigned consultant userId rather than profile id", async () => {
    user.findUnique.mockResolvedValue(actor("EXPERT"));
    await policy.assertPortrait(73, 29, "review");
    expect(studentPortrait.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ assignedExpert: expect.objectContaining({ userId: 73, isActive: true }) }) }),
    );
  });
  it("denies unassigned experts", async () => {
    user.findUnique.mockResolvedValue(actor("EXPERT"));
    studentPortrait.findFirst.mockResolvedValue(null);
    await expect(policy.assertPortrait(73, 29)).rejects.toBeInstanceOf(ForbiddenException);
  });
  it("denies inactive experts before querying portraits", async () => {
    user.findUnique.mockResolvedValue(actor("EXPERT", false));
    await expect(policy.assertPortrait(73, 29)).rejects.toBeInstanceOf(ForbiddenException);
    expect(studentPortrait.findFirst).not.toHaveBeenCalled();
  });
  it.each(["read", "review"] as const)("allows ADMIN %s without assignment", async operation => {
    user.findUnique.mockResolvedValue(actor("ADMIN"));
    await expect(policy.assertPortrait(73, 29, operation)).resolves.toEqual({});
  });
  it.each(["SALES_MANAGER", "PARENT", "OTHER"])("denies %s", async role => {
    user.findUnique.mockResolvedValue(actor(role));
    await expect(policy.assertPortrait(73, 29)).rejects.toBeInstanceOf(ForbiddenException);
  });
  it.each(["STUDENT", "SCHOOLBOY"])("denies review by %s", async role => {
    user.findUnique.mockResolvedValue(actor(role));
    await expect(policy.assertPortrait(73, 29, "review")).rejects.toBeInstanceOf(ForbiddenException);
  });
  it("denies blocked actors at the domain boundary", async () => {
    user.findUnique.mockResolvedValue({ ...actor("ADMIN"), deletedAt: new Date() });
    await expect(policy.assertPortrait(73, 29)).rejects.toBeInstanceOf(ForbiddenException);
  });
  it("denies deleted roles", async () => {
    user.findUnique.mockResolvedValue({ ...actor("ADMIN"), role: { code: "ADMIN", deletedAt: new Date() } });
    await expect(policy.assertPortrait(73, 29)).rejects.toBeInstanceOf(ForbiddenException);
  });
  it("denies missing actors", async () => {
    user.findUnique.mockResolvedValue(null);
    await expect(policy.assertPortrait(73, 29)).rejects.toBeInstanceOf(ForbiddenException);
  });
  it("does not authorize staff self upload", async () => {
    user.findUnique.mockResolvedValue(actor("ADMIN"));
    await expect(policy.assertPortrait(73, 29, "self")).rejects.toBeInstanceOf(ForbiddenException);
  });
  it("checks TargetProgram.id and portrait ownership together", async () => {
    await policy.assertOwnTargetProgram(7, 29);
    expect(targetProgram.findFirst).toHaveBeenCalledWith({ where: { id: 7, studentPortraitId: 29 }, select: { id: true } });
  });
  it("uses the same denial for missing and foreign target programs", async () => {
    targetProgram.findFirst.mockResolvedValue(null);
    await expect(policy.assertOwnTargetProgram(7, 29)).rejects.toThrow("Target program is not available for this student");
    await expect(policy.assertOwnTargetProgram(999, 29)).rejects.toThrow("Target program is not available for this student");
  });
});
