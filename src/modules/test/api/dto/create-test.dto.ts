import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsString, IsOptional, IsBoolean } from "class-validator";
import { Transform } from "class-transformer";
import messages from "src/configs/messages";

export class CreateTestDto {
  @ApiProperty({ example: "Math Test", description: "Test title" })
  @IsString({ message: messages.MUST_BE_STRING("Title") })
  @Transform(({ value }) => value.trim())
  title: string;

  @ApiPropertyOptional({ example: "Basic math test for students" })
  @IsOptional()
  @IsString({ message: messages.MUST_BE_STRING("Description") })
  description?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean({ message: messages.MUST_BE_BOOLEAN("Is Active") })
  @Transform(({ value }) => value === "true" || value === true)
  isActive?: boolean;
}
