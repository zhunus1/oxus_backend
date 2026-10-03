import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsIn, IsInt, IsISO8601, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from "class-validator";

export const EXPRESS_STUDY_FIELDS = ["IT", "ENGINEERING", "BUSINESS", "ECONOMICS", "AVIATION", "MEDICINE", "LAW", "OTHER"] as const;

export class ExpressSubmissionDto {
  @ApiProperty({ format: "uuid", description: "Client-generated idempotency key; reuse for retries of the same submission" })
  @IsUUID()
  submissionId: string;

  @ApiPropertyOptional({ format: "date-time" })
  @IsOptional()
  @IsISO8601({ strict: true })
  submittedAt?: string;

  @ApiProperty({ enum: ["ru", "kk"] })
  @IsIn(["ru", "kk"])
  locale: "ru" | "kk";

  @ApiProperty({ example: "Школа № 125" })
  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  @MaxLength(300)
  schoolName: string;

  @ApiProperty({ enum: [9, 10, 11], type: Number })
  @IsInt()
  @IsIn([9, 10, 11])
  grade: number;

  @ApiProperty({ example: "Алихан" })
  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  @MaxLength(100)
  firstName: string;

  @ApiProperty({ example: "Әлиев" })
  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  @MaxLength(100)
  lastName: string;

  @ApiPropertyOptional({ example: "Ерланұлы", nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  middleName?: string | null;

  @ApiProperty({ example: "+7 777 482 19 33", description: "International phone number used for WhatsApp / Telegram" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  phone: string;

  @ApiProperty({
    type: "array",
    items: { type: "integer", minimum: 1, maximum: 2_147_483_647 },
    minItems: 1,
    maxItems: 30,
    uniqueItems: true,
    description: "IDs from the Country directory",
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(2_147_483_647, { each: true })
  countryIds: number[];

  @ApiProperty({ enum: EXPRESS_STUDY_FIELDS, isArray: true, minItems: 1, maxItems: 8, uniqueItems: true })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(8)
  @ArrayUnique()
  @IsIn(EXPRESS_STUDY_FIELDS, { each: true })
  studyFields: (typeof EXPRESS_STUDY_FIELDS)[number][];
}
