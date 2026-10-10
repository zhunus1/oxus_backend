import { BadRequestException, ConflictException } from "@nestjs/common";
import type { PublicDocument } from "src/common/serialization/public-document";

/** All document writers advance this token, including writes in the same millisecond. */
export function nextDocumentTimestamp(previous: Date): Date {
  return new Date(Math.max(Date.now(), previous.getTime() + 1));
}

export interface DocumentSnapshot {
  expectedVersion: number;
  expectedUpdatedAt: string;
}

export function assertDocumentSnapshot(document: PublicDocument, snapshot: DocumentSnapshot) {
  if (
    !Number.isInteger(snapshot.expectedVersion) ||
    snapshot.expectedVersion < 1 ||
    snapshot.expectedVersion > 2147483647 ||
    typeof snapshot.expectedUpdatedAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(snapshot.expectedUpdatedAt) ||
    !Number.isFinite(Date.parse(snapshot.expectedUpdatedAt)) ||
    new Date(snapshot.expectedUpdatedAt).toISOString() !== snapshot.expectedUpdatedAt
  )
    throw new BadRequestException("Invalid document snapshot");
  if (document.version !== snapshot.expectedVersion || document.updatedAt.toISOString() !== snapshot.expectedUpdatedAt)
    throw new ConflictException("Document changed; reload before retrying");
}
