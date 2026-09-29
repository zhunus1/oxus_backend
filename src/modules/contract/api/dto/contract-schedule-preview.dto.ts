import { ApiProperty, PickType } from "@nestjs/swagger";
import { IsDateString, Matches } from "class-validator";
import { CreateContractForStudentDto } from "./create-contract-for-student.dto";

export class ContractSchedulePreviewDto extends PickType(CreateContractForStudentDto, ["price", "currency", "paymentType", "installmentCount"] as const) {
  @ApiProperty({ description: "Proposed first receipt timestamp with timezone; does not record a payment" })
  @IsDateString({ strict: true })
  @Matches(/T.*(?:Z|[+-]\d{2}:\d{2})$/, { message: "firstPaidAt must include a time and timezone" })
  firstPaidAt: string;
}
