import { OmitType, ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type, Transform } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
  MinLength,
} from "class-validator";
import { LeadMeetingFormat } from "generated/prisma/enums";
import { CreateManualLeadDto } from "./create-manual-lead.dto";
import { CreateLeadExpertCallDto } from "./create-lead-expert-call.dto";

/** Identifies one calculator answer, including free text when the option allows it. */
export class CalculatorAnswerDto {
  @ApiProperty()
  @IsString()
  @MaxLength(120)
  questionId: string;

  @ApiProperty()
  @IsString()
  @MaxLength(120)
  optionId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  freeText?: string;
}

/** Validates a partial calculator questionnaire for a supported role and language. */
export class CalculatorAnswersDto {
  @ApiProperty({ enum: ["parent", "student"] })
  @IsIn(["parent", "student"])
  role: "parent" | "student";

  @ApiProperty({ enum: ["ru", "kk"] })
  @IsIn(["ru", "kk"])
  locale: "ru" | "kk";

  @ApiPropertyOptional({ default: "2026-08-22" })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  quizVersion?: string;

  @ApiProperty({ type: [CalculatorAnswerDto] })
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => CalculatorAnswerDto)
  answers: CalculatorAnswerDto[];
}

/** Requires core lead contacts while allowing an unfinished questionnaire. */
export class CreateManualLeadV2Dto extends OmitType(CreateManualLeadDto, ["name", "phone", "email", "answers", "score", "percent", "universities"] as const) {
  @ApiProperty()
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  @ApiProperty()
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  phone: string;

  @ApiProperty()
  @Transform(({ value }) => (typeof value === "string" ? value.trim().toLowerCase() : value))
  @IsEmail()
  @MaxLength(320)
  email: string;

  @ApiPropertyOptional({ type: [CalculatorAnswerDto], description: "May be omitted or empty for a draft questionnaire" })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => CalculatorAnswerDto)
  answers?: CalculatorAnswerDto[];
}

/** Adds online or office consultation details to the existing call request contract. */
export class PreviewLeadMeetingDto extends CreateLeadExpertCallDto {
  @ApiProperty({ enum: LeadMeetingFormat })
  @IsEnum(LeadMeetingFormat)
  format: LeadMeetingFormat;

  @ApiPropertyOptional({ enum: ["almaty", "shymkent"] })
  @IsOptional()
  @IsIn(["almaty", "shymkent"])
  officeCode?: string;
}

/** References the preview whose booking will be revalidated and saved. */
export class SaveLeadMeetingDto {
  @ApiProperty()
  @IsUUID()
  invitationId: string;
}

/** Validates optional Expert questionnaire fields for incremental saving. */
export class ExpertQuestionnaireDto {
  @ApiPropertyOptional({ enum: ["STATE", "PRIVATE", "INTERNATIONAL"] })
  @IsOptional()
  @IsIn(["STATE", "PRIVATE", "INTERNATIONAL"])
  schoolType?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  schoolName?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  grade?: string;
  @ApiPropertyOptional({ example: "2008-04-17" })
  @IsOptional()
  @IsISO8601({ strict: true })
  birthDate?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  citizenshipCountryId?: number;
  @ApiPropertyOptional({ enum: ["YES", "NO", "IN_PROGRESS"] })
  @IsOptional()
  @IsIn(["YES", "NO", "IN_PROGRESS"])
  passport?: string;
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  favoriteSubjects?: string[];
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  dislikedSubjects?: string[];
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  languages?: string[];
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  otherLanguage?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  foundationYear?: boolean;
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  nonEnglishStudy?: boolean;
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  studyLanguages?: string[];
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  specialConditions?: boolean;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  specialConditionsComment?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  additionalInformation?: string;
}

/** Records a consultation outcome that returns the lead to Sales follow-up. */
export class ExpertFollowUpDto {
  @ApiProperty({ enum: ["FOLLOW_UP", "NO_SHOW", "RESCHEDULED"] })
  @IsIn(["FOLLOW_UP", "NO_SHOW", "RESCHEDULED"])
  reason: "FOLLOW_UP" | "NO_SHOW" | "RESCHEDULED";
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;
}

/** Validates the activation token and the student-selected password. */
export class AcceptStudentInvitationDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  token: string;
  @ApiProperty()
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password: string;
}
