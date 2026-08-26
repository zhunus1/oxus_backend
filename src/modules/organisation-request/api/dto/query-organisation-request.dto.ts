import { ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsEnum, IsInt, IsOptional, IsPositive } from "class-validator";
import { OrganisationRequestStatus } from "generated/prisma/enums";
import messages from "src/configs/messages";

export class QueryOrganisationRequestDto {
  @ApiPropertyOptional({ enum: OrganisationRequestStatus })
  @IsOptional()
  @IsEnum(OrganisationRequestStatus, { message: messages.MUST_BE_VALID_ENUM("status", Object.values(OrganisationRequestStatus)) })
  status?: OrganisationRequestStatus;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: messages.MUST_BE_INT("skip") })
  skip?: number;

  @ApiPropertyOptional({ example: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: messages.MUST_BE_INT("take") })
  @IsPositive({ message: messages.MUST_BE_POSITIVE("take") })
  take?: number;
}
