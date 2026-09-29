import { ConfigService } from "@nestjs/config";
import { ForbiddenException } from "@nestjs/common";
import { CreateBucketCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { PrismaService } from "src/database/prisma.service";
import { ContractScanService } from "./contract-scan.service";
import { ownedContract } from "../domain/manual-contract-confirmation";
import { assertContractAccess } from "../domain/contract-access";

jest.mock("src/database/prisma.service", () => ({ PrismaService: class {} }));
jest.mock("../domain/manual-contract-confirmation", () => ({ ownedContract: jest.fn() }));
jest.mock("../domain/contract-access", () => ({ assertContractAccess: jest.fn(), assertStudentContractRead: jest.fn() }));
jest.mock("src/modules/lead/domain/lead-transaction", () => ({ leadTransaction: (prisma: unknown, fn: (tx: unknown) => unknown) => fn(prisma) }));

describe("paper contract scan privacy", () => {
  const findUnique = jest.fn(),
    update = jest.fn(),
    audit = jest.fn(),
    findUser = jest.fn();
  const prisma = { contract: { findUnique, update }, auditLog: { create: audit }, user: { findUnique: findUser } } as unknown as PrismaService;
  const contract = { id: "contract", studentId: 7, signedByUserId: 3, status: "SIGNED", scanFileKey: "contract/existing" };
  const file = { buffer: Buffer.from("%PDF-1.7 test"), mimetype: "application/pdf" } as Express.Multer.File;
  let service: ContractScanService;
  let send: jest.SpyInstance;

  beforeEach(() => {
    jest.resetAllMocks();
    send = jest.spyOn(S3Client.prototype, "send").mockResolvedValue({} as never);
    findUnique.mockResolvedValue(contract);
    jest.mocked(ownedContract).mockResolvedValue({ contract } as never);
    service = new ContractScanService(
      prisma,
      new ConfigService({ AWS_BUCKET_NAME: "media", AWS_MINIO_ENDPOINT: "http://localhost:9000", AWS_ACCESS_KEY_ID: "test", AWS_SECRET_ACCESS_KEY: "test" }),
    );
  });
  afterEach(() => jest.restoreAllMocks());

  it("rejects another student's download before contacting storage", async () => {
    jest.mocked(assertContractAccess).mockRejectedValue(new ForbiddenException());
    await expect(service.download("contract", 8)).rejects.toBeInstanceOf(ForbiddenException);
    expect(send).not.toHaveBeenCalled();
  });

  it("rejects an unauthorized upload before contacting storage", async () => {
    jest.mocked(ownedContract).mockRejectedValue(new ForbiddenException());
    await expect(service.upload("contract", 8, file)).rejects.toBeInstanceOf(ForbiddenException);
    expect(send).not.toHaveBeenCalled();
  });

  it("rejects executable content disguised as a PDF", async () => {
    await expect(service.upload("contract", 3, { ...file, buffer: Buffer.from("<script>alert(1)</script>") })).rejects.toMatchObject({ status: 400 });
    expect(send).not.toHaveBeenCalled();
  });

  it("stores scans in a separate bucket without a public ACL or bucket policy", async () => {
    send.mockImplementation(command => {
      if (command instanceof HeadBucketCommand) return Promise.reject(Object.assign(new Error("Bucket not found"), { name: "NotFound", $metadata: { httpStatusCode: 404 } }));
      return Promise.resolve({});
    });
    await expect(service.upload("contract", 3, file)).resolves.toEqual({ contractId: "contract", hasScan: true });
    const commands = send.mock.calls.map(([command]) => command);
    expect(commands.map(command => command.constructor)).toEqual([HeadBucketCommand, CreateBucketCommand, PutObjectCommand]);
    expect(commands.every(command => command.input.Bucket === "media-contracts")).toBe(true);
    expect(commands[2].input.ACL).toBeUndefined();
    expect(update).toHaveBeenCalledWith({ where: { id: "contract" }, data: { scanFileKey: expect.stringMatching(/^contract\//) } });
    expect(ownedContract).toHaveBeenCalledTimes(2);
  });

  it("streams the owning student's scan without exposing a public URL", async () => {
    send.mockResolvedValue({ ContentType: "application/pdf", Body: { transformToByteArray: async () => file.buffer } });
    const result = await service.download("contract", 7);
    expect(result.getHeaders().type).toBe("application/pdf");
    expect(send.mock.calls[0][0]).toBeInstanceOf(GetObjectCommand);
    expect(send.mock.calls[0][0].input).toEqual({ Bucket: "media-contracts", Key: "contract/existing" });
  });
});
