import { IsEnum, IsOptional, IsString } from "class-validator";
import messages from "src/configs/messages";

export class UpdateTransactionDto {
  @IsOptional()
  @IsEnum(["SUCCESS", "PENDING", "FAILED"], { message: messages.MUST_BE_VALID_ENUM("status", ["SUCCESS", "PENDING", "FAILED"]) })
  status?: string;

  @IsString()
  @IsOptional()
  providerRef?: string;
}
