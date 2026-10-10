import { PUBLIC_DOCUMENT_SELECT, toPublicDocument, type PublicDocument } from "./public-document";
import { DocumentEntity } from "src/modules/document/api/dto/document.entity";

jest.mock("generated/prisma/client", () => ({ RequirementType: { PASSPORT: "PASSPORT" } }));

describe("Public Document serialization", () => {
  const fields = ["id", "title", "fileUrl", "documentType", "version", "status", "feedback", "studentPortraitId", "targetProgramId", "createdAt", "updatedAt"];
  const document: PublicDocument = {
    id: 1,
    title: "Passport",
    fileUrl: "https://files.example.test/passport",
    documentType: "PASSPORT",
    version: 2,
    status: "REVIEW",
    feedback: null,
    studentPortraitId: 7,
    targetProgramId: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-02"),
  };

  it("preserves the eleven public values and dates while excluding present and future internal properties", () => {
    const raw = { ...document, fileKey: "private/passport", deletedAt: new Date(), futureInternalField: "must stay private", studentPortrait: { userId: 99 } };
    const result = toPublicDocument(raw);
    expect(result).toEqual(document);
    expect(Object.keys(result).sort()).toEqual([...fields].sort());
    expect(JSON.parse(JSON.stringify(result))).toEqual({ ...document, createdAt: document.createdAt.toISOString(), updatedAt: document.updatedAt.toISOString() });
  });

  it("does not accept extra properties through the existing DocumentEntity constructor", () => {
    const raw = { ...document, fileKey: "private/passport", deletedAt: new Date(), futureInternalField: "hidden" };
    const entity = new DocumentEntity(raw);
    expect(JSON.parse(JSON.stringify(entity))).toEqual(JSON.parse(JSON.stringify(document)));
  });

  it("keeps partial entity construction and existing null fields compatible", () => {
    const entity = new DocumentEntity({ id: 1, feedback: null, targetProgramId: null });
    expect(JSON.parse(JSON.stringify(entity))).toEqual({ id: 1, feedback: null, targetProgramId: null });
    expect(Object.keys(PUBLIC_DOCUMENT_SELECT).sort()).toEqual([...fields].sort());
  });
});
