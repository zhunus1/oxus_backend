import { ApiProperty, ApiPropertyOptional, OmitType } from "@nestjs/swagger";
import { IsEmail, IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from "class-validator";
import { Transform } from "class-transformer";
import { CreateContractForStudentDto } from "src/modules/contract/api/dto/create-contract-for-student.dto";
/** Validates student identity and agreed contract terms; account reuse requires explicit confirmation. */
export class PrepareLeadContractDto extends OmitType(CreateContractForStudentDto, ["studentId", "contractNumber"] as const) {
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
