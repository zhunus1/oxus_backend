import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { DocumentStatus, RequirementType } from "generated/prisma/enums";

export class ProgramRequirementStatusEntity {
  @ApiProperty()
  requirementId: number;

  @ApiProperty({ enum: RequirementType })
  type: RequirementType;

  @ApiProperty()
  title: string;

  @ApiPropertyOptional()
  description?: string | null;

  @ApiProperty()
  isRequired: boolean;

  @ApiProperty()
  sortOrder: number;

  @ApiProperty()
  isSubmitted: boolean;

  @ApiPropertyOptional()
  documentId?: number | null;

  @ApiPropertyOptional()
  documentTitle?: string | null;

  @ApiPropertyOptional({ enum: DocumentStatus })
  documentStatus?: DocumentStatus | null;
}
