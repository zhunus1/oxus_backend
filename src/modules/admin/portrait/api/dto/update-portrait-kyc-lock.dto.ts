import { ApiProperty } from "@nestjs/swagger";
import { IsBoolean } from "class-validator";
import messages from "src/configs/messages";

export class UpdatePortraitKycLockDto {
  @ApiProperty({ example: true })
  @IsBoolean({ message: messages.MUST_BE_BOOLEAN("isIdentityLocked") })
  isIdentityLocked: boolean;
}
