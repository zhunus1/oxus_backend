import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString } from "class-validator";
import messages from "src/configs/messages";

export class ReviewOrganisationRequestDto {
  @ApiPropertyOptional({ example: "Organisation exists in QS import and can be imported next." })
  @IsOptional()
  @IsString({ message: messages.MUST_BE_STRING("reviewNote") })
  reviewNote?: string;
}
