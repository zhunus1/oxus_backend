import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsBoolean, IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, Min } from "class-validator";
import { RequirementType } from "generated/prisma/enums";

export class CreateProgramRequirementDto {
  @ApiProperty({ enum: RequirementType, example: RequirementType.TRANSCRIPT })
  @IsEnum(RequirementType)
  type: RequirementType;

  @ApiProperty({ example: "Academic Transcript" })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiPropertyOptional({ example: "Official transcript required for admission review" })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ example: true })
  @IsBoolean()
  isRequired: boolean;

  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(0)
  sortOrder: number;
}
