import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsEnum, IsOptional, IsString } from "class-validator";
import { DocumentStatus } from "generated/prisma/client";
import messages from "src/configs/messages";

export class ReviewDocumentDto {
  @ApiProperty({ enum: ["NEEDS_REVISION", "APPROVED"] })
  @IsEnum(DocumentStatus, { message: messages.MUST_BE_VALID_ENUM("status", ["NEEDS_REVISION", "APPROVED"]) })
  status: DocumentStatus;

  @ApiPropertyOptional({ example: "Please fix the introduction paragraph" })
  @IsOptional()
  @IsString({ message: messages.MUST_BE_STRING("feedback") })
  feedback?: string;
}
