import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsEnum, IsOptional } from "class-validator";
import { ContractStatus } from "generated/prisma/enums";
import { PageQueryDto } from "src/common/dto/page-query.dto";

export class ContractsQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: ContractStatus })
  @IsOptional()
  @IsEnum(ContractStatus)
  status?: ContractStatus;
}
