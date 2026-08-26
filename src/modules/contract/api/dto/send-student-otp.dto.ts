import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsString, Matches } from "class-validator";
import messages from "src/configs/messages";

export class SendStudentOtpDto {
  @ApiProperty({ example: "+77001234567", description: "Phone number from the contract (may belong to parent/guardian)" })
  @IsString()
  @IsNotEmpty({ message: messages.REQUIRED_FIELD("clientPhone") })
  @Matches(/^\+?\d{7,15}$/, { message: "Enter a valid phone number" })
  clientPhone: string;
}
