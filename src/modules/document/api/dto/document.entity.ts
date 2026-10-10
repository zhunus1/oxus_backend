import { ApiProperty } from "@nestjs/swagger";
import { RequirementType, DocumentStatus } from "generated/prisma/client";
import { toPublicDocument } from "src/common/serialization/public-document";

export class DocumentEntity {
  @ApiProperty({ type: "integer" }) id: number;
  @ApiProperty() title: string;
  @ApiProperty({ description: "Private documents: relative authenticated backend download endpoint. Legacy documents: existing URL; send JWT explicitly for private downloads." })
  fileUrl: string;
  @ApiProperty({ enum: RequirementType }) documentType: RequirementType;
  @ApiProperty({ type: "integer" }) version: number;
  @ApiProperty({ enum: DocumentStatus }) status: DocumentStatus;
  @ApiProperty({ type: String, nullable: true }) feedback: string | null;
  @ApiProperty({ type: "integer" }) studentPortraitId: number;
  @ApiProperty({ type: "integer", nullable: true }) targetProgramId: number | null;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;

  constructor(partial: Partial<DocumentEntity>) {
    Object.assign(this, toPublicDocument(partial));
  }
}
