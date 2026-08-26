import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsEnum, IsInt, Min } from "class-validator";
import { SubscriptionTier } from "generated/prisma/enums";
import messages from "src/configs/messages";

export class UpdatePortraitSubscriptionDto {
  @ApiProperty({ enum: SubscriptionTier, example: SubscriptionTier.AI_ROADMAP })
  @IsEnum(SubscriptionTier, {
    message: messages.MUST_BE_VALID_ENUM("subscription", Object.values(SubscriptionTier)),
  })
  subscription: SubscriptionTier;

  @ApiProperty({ example: 3 })
  @Type(() => Number)
  @IsInt({ message: messages.MUST_BE_INT("consultationBalance") })
  @Min(0, { message: messages.MUST_BE_MIN("consultationBalance", 0) })
  consultationBalance: number;
}
