import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { RequirementType } from "generated/prisma/enums";

export class ProgramRequirementEntity {
  @ApiProperty()
  id: number;

  @ApiProperty()
  programId: number;

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
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
