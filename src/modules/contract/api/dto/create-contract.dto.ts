import { ApiProperty } from "@nestjs/swagger";
import { IsEnum, IsNotEmpty } from "class-validator";
import { SubscriptionTier } from "generated/prisma/enums";
import messages from "src/configs/messages";

export class CreateContractDto {
  @ApiProperty({ enum: SubscriptionTier, example: SubscriptionTier.EXPERT_MENTORSHIP })
  @IsEnum(SubscriptionTier, { message: messages.MUST_BE_VALID_ENUM("subscriptionTier", Object.values(SubscriptionTier)) })
  @IsNotEmpty({ message: messages.REQUIRED_FIELD("subscriptionTier") })
  subscriptionTier: SubscriptionTier;
}
