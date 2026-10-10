import { BadRequestException, Injectable, type PipeTransform } from "@nestjs/common";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { plainToInstance, Transform, Type } from "class-transformer";
import { IsEnum, IsInt, IsISO8601, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateIf, validateSync } from "class-validator";
import { DocumentStatus, RequirementType } from "generated/prisma/client";
import { PageQueryDto } from "src/common/dto/page-query.dto";
import type { DocumentSnapshot } from "../../repository/document-snapshot";

export class StaffDocumentSnapshotDto implements DocumentSnapshot {
  @ApiProperty({ minimum: 1, maximum: 2147483647 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2147483647)
  expectedVersion: number;

  @ApiProperty({ example: "2026-10-10T00:00:00.000Z", description: "Exact updatedAt from the last document response" })
  @IsString()
  @IsISO8601({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  expectedUpdatedAt: string;
}

export class StaffCreateDocumentDto {
  @ApiProperty({ maxLength: 255 })
  @Transform(({ value }: { value: unknown }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  title: string;

  @ApiProperty({ enum: RequirementType })
  @IsEnum(RequirementType)
  documentType: RequirementType;

  @ApiPropertyOptional({ minimum: 1, maximum: 2147483647 })
  @ValidateIf((_object, value) => value !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2147483647)
  targetProgramId?: number;
}

export class StaffUpdateDocumentDto extends StaffDocumentSnapshotDto {
  @ApiProperty({ maxLength: 255, description: "The only editable metadata field; file version/status/feedback are preserved" })
  @Transform(({ value }: { value: unknown }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  title: string;
}

export class StaffDocumentsQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: DocumentStatus })
  @ValidateIf((_object, value) => value !== undefined)
  @IsEnum(DocumentStatus)
  status?: DocumentStatus;
  @ApiPropertyOptional({ enum: RequirementType })
  @ValidateIf((_object, value) => value !== undefined)
  @IsEnum(RequirementType)
  documentType?: RequirementType;
  @ApiPropertyOptional({ minimum: 1, maximum: 2147483647 })
  @ValidateIf((_object, value) => value !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2147483647)
  targetProgramId?: number;
}

type StaffNumericInput = "number" | "decimal";
const numericBounds = { expectedVersion: 2147483647, targetProgramId: 2147483647, page: Number.MAX_SAFE_INTEGER, limit: 100 };

/** Check the original primitive before any class-transformer or JavaScript coercion. */
function staffPositiveInteger(value: unknown, maximum: number, input: StaffNumericInput): number {
  if (typeof value !== "number" && !(input === "decimal" && typeof value === "string" && /^[1-9]\d*$/.test(value)))
    throw new BadRequestException("Invalid staff document numeric input");
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > maximum) throw new BadRequestException("Invalid staff document numeric input");
  return number;
}

/** Direct services accept typed numbers; only validated query/multipart strings may be converted. */
export function validateStaffDto<T extends object>(type: new () => T, value: T, input: StaffNumericInput = "number"): T {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.values(value).some(v => v === null)) throw new BadRequestException("Invalid staff document input");
  for (const [field, maximum] of Object.entries(numericBounds)) {
    const raw = (value as Record<string, unknown>)[field];
    if (raw !== undefined) staffPositiveInteger(raw, maximum, input);
  }
  const dto = plainToInstance(type, value);
  if (validateSync(dto, { whitelist: true, forbidNonWhitelisted: true }).length) throw new BadRequestException("Invalid staff document input");
  return dto;
}

export function staffDocumentId(value: unknown): number {
  return staffPositiveInteger(value, 2147483647, "decimal");
}

@Injectable()
export class StaffDocumentIdPipe implements PipeTransform {
  transform(value: unknown) {
    return staffDocumentId(value);
  }
}
