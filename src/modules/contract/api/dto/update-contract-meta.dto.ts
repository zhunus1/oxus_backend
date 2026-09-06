import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsDateString, IsIn, IsNumber, IsOptional, IsPositive, IsString, Matches } from "class-validator";
import messages from "src/configs/messages";

/** Accepts both legacy and server-generated CRM contract numbers when editing unsigned terms. */
export class UpdateContractMetaDto {
  @ApiPropertyOptional({ example: "OXUS-2026-0001" })
  @IsOptional()
  @IsString()
  @Matches(/^OXUS-\d{4}-(?:\d{4}|CRM-\d{6,10})$/, { message: "contractNumber must match OXUS-YYYY-NNNN or OXUS-YYYY-CRM-NNNNNN" })
  contractNumber?: string;

  @ApiPropertyOptional({ example: 150000 })
  @IsOptional()
  @IsNumber()
  @IsPositive({ message: messages.MUST_BE_POSITIVE("price") })
  price?: number;

  @ApiPropertyOptional({ example: "KZT", enum: ["KZT", "USD", "EUR"] })
  @IsOptional()
  @IsIn(["KZT", "USD", "EUR"], { message: "currency must be KZT, USD, or EUR" })
  currency?: string;

  @ApiPropertyOptional({ example: "2026-05-01T00:00:00Z" })
  @IsOptional()
  @IsDateString({}, { message: messages.MUST_BE_DATE("serviceStartDate") })
  serviceStartDate?: string;

  @ApiPropertyOptional({ example: "2027-05-01T00:00:00Z" })
  @IsOptional()
  @IsDateString({}, { message: messages.MUST_BE_DATE("serviceEndDate") })
  serviceEndDate?: string;
}
