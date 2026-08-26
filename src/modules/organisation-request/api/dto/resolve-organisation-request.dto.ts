import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsInt, IsOptional, IsPositive, IsString } from "class-validator";
import messages from "src/configs/messages";
import { Exists } from "src/common/validators/exists.validator";

export class ResolveOrganisationRequestDto {
  @ApiProperty({ example: 15 })
  @IsInt({ message: messages.MUST_BE_INT("resolvedOrganisationId") })
  @IsPositive({ message: messages.MUST_BE_POSITIVE("resolvedOrganisationId") })
  @Exists("organisation", { message: args => messages.INVALID_RELATION("organisation", args.value) })
  resolvedOrganisationId: number;

  @ApiPropertyOptional({ example: "Resolved to the newly imported Imperial College London organisation." })
  @IsOptional()
  @IsString({ message: messages.MUST_BE_STRING("reviewNote") })
  reviewNote?: string;
}
