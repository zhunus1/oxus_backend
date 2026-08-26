import { ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsInt, IsOptional, IsPositive } from "class-validator";
import messages from "src/configs/messages";

export class CreateQsImportJobDto {
  @ApiPropertyOptional({ example: 250, description: "Optional number of ranking rows to import from the uploaded file" })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: messages.MUST_BE_INT("limit") })
  @IsPositive({ message: messages.MUST_BE_POSITIVE("limit") })
  limit?: number;
}
