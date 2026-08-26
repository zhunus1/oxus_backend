import { PartialType } from "@nestjs/mapped-types";
import { CreateRoleDto } from "./create-role.dto";
import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsArray, IsInt, IsNotEmpty, IsString } from "class-validator";

export class UpdateRoleDto extends PartialType(CreateRoleDto) {
  @ApiPropertyOptional({ example: "Moderator" })
  @IsNotEmpty()
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({
    example: [1, 2],
    description: "Array of permission IDs",
    required: false,
  })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  permissionIds?: number[];
}
