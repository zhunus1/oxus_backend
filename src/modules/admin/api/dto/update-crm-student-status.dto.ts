import { ApiProperty } from "@nestjs/swagger";
import { IsIn, IsString } from "class-validator";
import { CRM_STUDENT_STATUSES } from "../../crm/crm-status.mapper";

export class UpdateCrmStudentStatusDto {
  @ApiProperty({ enum: CRM_STUDENT_STATUSES })
  @IsString()
  @IsIn([...CRM_STUDENT_STATUSES], { message: "Invalid CRM status" })
  status!: string;
}
