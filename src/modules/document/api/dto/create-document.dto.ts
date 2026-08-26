import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsEnum, IsInt, IsNotEmpty, IsOptional, IsString } from "class-validator";
import { Type } from "class-transformer";
import messages from "src/configs/messages";
import { RequirementType } from "generated/prisma/client";

export class CreateDocumentDto {
  @ApiProperty({ example: "Motivation Letter" })
  @IsString({ message: messages.MUST_BE_STRING("title") })
  @IsNotEmpty({ message: messages.NOT_EMPTY("title") })
  title: string;

  @ApiProperty({ enum: RequirementType, example: RequirementType.SOP })
  @IsEnum(RequirementType)
  documentType: RequirementType;

  @ApiPropertyOptional({ example: 1, description: "Target program ID to associate with" })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: messages.MUST_BE_NUMBER("targetProgramId") })
  targetProgramId?: number;
}
