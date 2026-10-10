import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsPositive, Max, Min } from "class-validator";
import type { ContractPaymentType } from "generated/prisma/enums";
import { MAX_NEW_CONTRACT_INSTALLMENTS } from "../../domain/manual-contract.constants";

export class ContractPaymentTermsDto {
  @ApiPropertyOptional({ enum: ["FULL", "INSTALLMENT"], default: "FULL" })
  @IsOptional()
  @IsIn(["FULL", "INSTALLMENT"])
  paymentType?: ContractPaymentType;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: MAX_NEW_CONTRACT_INSTALLMENTS,
    description: "Total payments including the first receipt: FULL uses 1; INSTALLMENT requires 2 or 3 monthly payments",
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_NEW_CONTRACT_INSTALLMENTS)
  installmentCount?: number;
}

export class ConfirmInstallmentDto {
  @ApiProperty({ description: "Actual receipt timestamp with timezone; starts the monthly schedule for the first payment" })
  @IsDateString({ strict: true })
  paidAt: string;

  @ApiProperty({ description: "Received amount in the contract currency (KZT for new contracts), must equal the scheduled payment" })
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount: number;
}

export class ConfirmManualContractDto extends ConfirmInstallmentDto {
  @ApiPropertyOptional({ description: "Actual manual signature timestamp; may be omitted if already recorded" })
  @IsOptional()
  @IsDateString({ strict: true })
  signedAt?: string;

  @ApiPropertyOptional({ description: "Explicit confirmation of a matching existing student" })
  @IsOptional()
  @IsInt()
  @Min(1)
  existingStudentId?: number;
}

export class RecordContractSignatureDto {
  @ApiProperty({ description: "Manual signature timestamp. Does not close the lead or create an account." })
  @IsDateString({ strict: true })
  signedAt: string;
}
