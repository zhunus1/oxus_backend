import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { RequirementType, type DocumentStatus } from "generated/prisma/client";
import { toPublicDocument } from "src/common/serialization/public-document";

export class DocumentEntity {
  @ApiProperty() id: number;
  @ApiProperty() title: string;
  @ApiProperty() fileUrl: string;
  @ApiProperty({ enum: RequirementType }) documentType: RequirementType;
  @ApiProperty() version: number;
  @ApiProperty() status: DocumentStatus;
  @ApiPropertyOptional() feedback: string | null;
  @ApiProperty() studentPortraitId: number;
  @ApiPropertyOptional() targetProgramId: number | null;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;

  constructor(partial: Partial<DocumentEntity>) {
    Object.assign(this, toPublicDocument(partial));
  }
}
