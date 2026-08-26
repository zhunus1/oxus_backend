import { ApiPropertyOptional } from "@nestjs/swagger";
import { Type, Transform } from "class-transformer";
import { IsBoolean, IsEnum, IsInt, IsOptional, Min } from "class-validator";
import { ProcessStep, SubscriptionTier } from "generated/prisma/enums";
import messages from "src/configs/messages";

export class StudentPortraitQueryDto {
  @ApiPropertyOptional({ enum: SubscriptionTier, example: SubscriptionTier.FREE })
  @IsOptional()
  @IsEnum(SubscriptionTier, {
    message: messages.MUST_BE_VALID_ENUM("subscription", Object.values(SubscriptionTier)),
  })
  subscription?: SubscriptionTier;

  @ApiPropertyOptional({ enum: ProcessStep, example: ProcessStep.DISCOVERY })
  @IsOptional()
  @IsEnum(ProcessStep, {
    message: messages.MUST_BE_VALID_ENUM("currentStep", Object.values(ProcessStep)),
  })
  currentStep?: ProcessStep;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @Transform(({ value }) => {
    if (value === "true") return true;
    if (value === "false") return false;
    return value;
  })
  @IsBoolean({ message: messages.MUST_BE_BOOLEAN("hasVisa") })
  hasVisa?: boolean;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: messages.MUST_BE_INT("skip") })
  @Min(0, { message: messages.MUST_BE_MIN("skip", 0) })
  skip?: number = 0;

  @ApiPropertyOptional({ default: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: messages.MUST_BE_INT("take") })
  @Min(1, { message: messages.MUST_BE_MIN("take", 1) })
  take?: number = 10;
}
