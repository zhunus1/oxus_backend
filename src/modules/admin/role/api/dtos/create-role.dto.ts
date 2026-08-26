import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsString, IsArray, IsOptional, IsInt } from "class-validator";

export class CreateRoleDto {
  @ApiProperty({ example: "Moderator" })
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiProperty({ example: "MODERATOR" })
  @IsNotEmpty()
  @IsString()
  @IsOptional()
  code?: string;

  @ApiProperty({ example: "DESCRIPTION" })
  @IsNotEmpty()
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({
    example: [1, 2],
    description: "Array of permission IDs",
    required: false,
  })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  permissions?: number[];
}
