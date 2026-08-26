import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { RequirementType } from "generated/prisma/client";

export class DocumentEntity {
  @ApiProperty() id: number;
  @ApiProperty() title: string;
  @ApiProperty() fileUrl: string;
  @ApiProperty({ enum: RequirementType }) documentType: RequirementType;
  @ApiProperty() version: number;
  @ApiProperty() status: string;
  @ApiPropertyOptional() feedback: string | null;
  @ApiProperty() studentPortraitId: number;
  @ApiPropertyOptional() targetProgramId: number | null;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;

  constructor(partial: Partial<DocumentEntity>) {
    Object.assign(this, partial);
  }
}
