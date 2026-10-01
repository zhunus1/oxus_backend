import { ApiProperty, ApiPropertyOptional, OmitType } from "@nestjs/swagger";
import { IsEmail, IsInt, IsOptional, IsString, MaxLength, Min, MinLength, ValidateNested } from "class-validator";
import { Transform, Type } from "class-transformer";
import { CreateContractForStudentDto } from "src/modules/contract/api/dto/create-contract-for-student.dto";
export class ContractParentDto {
  @ApiProperty()
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstname: string;

  @ApiProperty()
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  lastname: string;

  @ApiPropertyOptional({ nullable: true })
  @Transform(({ value }) => (typeof value === "string" ? value.trim() || null : value))
  @IsOptional()
  @IsString()
  @MaxLength(100)
  middlename?: string | null;

  @ApiPropertyOptional()
  @Transform(({ value }) => (typeof value === "string" ? value.trim().toLowerCase() : value))
  @IsOptional()
  @IsEmail()
  @MaxLength(320)
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;
}

/** Validates a pre-account contract draft; all unprefixed identity fields belong to the student. */
export class PrepareLeadContractDto extends OmitType(CreateContractForStudentDto, ["studentId", "contractNumber"] as const) {
  @ApiPropertyOptional({ type: ContractParentDto, description: "Separate parent identity; required for parent leads" })
  @IsOptional()
  @ValidateNested()
  @Type(() => ContractParentDto)
  parent?: ContractParentDto;
  @ApiProperty({ description: "Student identity; for a parent lead these are the child's contacts" })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstname: string;
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  lastname: string;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 100, description: "Student patronymic; omitted, null or blank means no patronymic" })
  @Transform(({ value }) => (typeof value === "string" ? value.trim() || null : value))
  @IsOptional()
  @IsString()
  @MaxLength(100)
  middlename?: string | null;
  @ApiProperty()
  @Transform(({ value }) => (typeof value === "string" ? value.trim().toLowerCase() : value))
  @IsEmail()
  @MaxLength(320)
  email: string;
  @ApiProperty()
  @IsString()
  @MaxLength(50)
  phone: string;
  @ApiPropertyOptional({ description: "Explicit confirmation to reuse an existing student account matching both contacts" })
  @IsOptional()
  @IsInt()
  @Min(1)
  existingStudentId?: number;
}
