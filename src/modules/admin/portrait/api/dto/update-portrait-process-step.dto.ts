import { ApiProperty } from "@nestjs/swagger";
import { IsEnum } from "class-validator";
import { ProcessStep } from "generated/prisma/client";
import messages from "src/configs/messages";

export class UpdatePortraitProcessStepDto {
  @ApiProperty({ enum: ProcessStep })
  @IsEnum(ProcessStep, { message: messages.MUST_BE_VALID_ENUM("currentStep", Object.values(ProcessStep)) })
  currentStep: ProcessStep;
}
