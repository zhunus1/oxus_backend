import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsEnum, IsOptional, IsString } from "class-validator";
import { SubscriptionTier } from "generated/prisma/client";

export class InitPaymentDto {
  @ApiProperty({ enum: SubscriptionTier, example: SubscriptionTier.AI_ROADMAP })
  @IsEnum(SubscriptionTier, { message: "subscriptionTier must be AI_ROADMAP or EXPERT_MENTORSHIP" })
  subscriptionTier: SubscriptionTier;

  @ApiPropertyOptional({ example: "SPRING2026" })
  @IsOptional()
  @IsString()
  promoCode?: string;
}
