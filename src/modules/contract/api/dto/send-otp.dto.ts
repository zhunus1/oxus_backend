import { ApiProperty } from "@nestjs/swagger";
import { IsIn, IsNotEmpty } from "class-validator";
import messages from "src/configs/messages";

export class SendOtpDto {
  @ApiProperty({ enum: ["student", "expert"], example: "student" })
  @IsIn(["student", "expert"], { message: messages.MUST_BE_VALID_ENUM("role", ["student", "expert"]) })
  @IsNotEmpty({ message: messages.REQUIRED_FIELD("role") })
  role: "student" | "expert";
}
