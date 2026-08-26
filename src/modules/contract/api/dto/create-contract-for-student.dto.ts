import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsDateString, IsEnum, IsIn, IsNotEmpty, IsNumber, IsOptional, IsPositive, IsString } from "class-validator";
import { SubscriptionTier } from "generated/prisma/enums";
import { Exists } from "src/common/validators/exists.validator";
import messages from "src/configs/messages";

export class CreateContractForStudentDto {
  @ApiProperty({ example: 42 })
  @IsNumber()
  @IsPositive({ message: messages.MUST_BE_POSITIVE("studentId") })
  @Exists("user", { message: args => messages.INVALID_RELATION("student", args.value) })
  studentId: number;

  @ApiProperty({ enum: SubscriptionTier, example: SubscriptionTier.EXPERT_MENTORSHIP })
  @IsEnum(SubscriptionTier, { message: messages.MUST_BE_VALID_ENUM("subscriptionTier", Object.values(SubscriptionTier)) })
  @IsNotEmpty()
  subscriptionTier: SubscriptionTier;

  @ApiProperty({ example: 150000 })
  @IsNumber()
  @IsPositive({ message: messages.MUST_BE_POSITIVE("price") })
  price: number;

  @ApiProperty({ example: "KZT", enum: ["KZT", "USD", "EUR"] })
  @IsIn(["KZT", "USD", "EUR"], { message: "currency must be KZT, USD, or EUR" })
  @IsNotEmpty()
  currency: string;

  @ApiPropertyOptional({ example: "2026-05-01T00:00:00Z" })
  @IsOptional()
  @IsDateString({}, { message: messages.MUST_BE_DATE("serviceStartDate") })
  serviceStartDate?: string;

  @ApiPropertyOptional({ example: "2027-05-01T00:00:00Z" })
  @IsOptional()
  @IsDateString({}, { message: messages.MUST_BE_DATE("serviceEndDate") })
  serviceEndDate?: string;

  @ApiPropertyOptional({ example: "OXUS-2026-0001" })
  @IsOptional()
  @IsString()
  contractNumber?: string;
}
