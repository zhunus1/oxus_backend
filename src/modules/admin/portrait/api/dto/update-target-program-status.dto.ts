import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsEnum, IsOptional, IsString } from "class-validator";
import { ApplicationStatus } from "generated/prisma/client";
import messages from "src/configs/messages";

export class UpdateTargetProgramStatusDto {
  @ApiProperty({ enum: ApplicationStatus })
  @IsEnum(ApplicationStatus, { message: messages.MUST_BE_VALID_ENUM("applicationStatus", Object.values(ApplicationStatus)) })
  applicationStatus: ApplicationStatus;

  @ApiPropertyOptional({ example: "Student passed interview successfully" })
  @IsOptional()
  @IsString({ message: messages.MUST_BE_STRING("comment") })
  comment?: string;
}
