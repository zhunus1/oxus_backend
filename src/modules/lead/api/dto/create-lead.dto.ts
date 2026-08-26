import { ApiProperty } from "@nestjs/swagger";
import { IsEmail, IsIn, IsNotEmpty, IsString } from "class-validator";

export class CreateLeadDto {
  @ApiProperty({ example: "Aisha" })
  @IsString()
  @IsNotEmpty()
  firstName: string;

  @ApiProperty({ example: "Bekova" })
  @IsString()
  @IsNotEmpty()
  lastName: string;

  @ApiProperty({ example: "+77001234567" })
  @IsString()
  @IsNotEmpty()
  phone: string;

  @ApiProperty({ example: "aisha@example.com" })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({ example: "Study abroad opportunities" })
  @IsString()
  @IsNotEmpty()
  topic: string;

  @ApiProperty({ example: "Interested in UK universities, MBA programs" })
  @IsString()
  @IsNotEmpty()
  interests: string;

  @ApiProperty({ example: "student", enum: ["student", "parent", "teacher", "other"] })
  @IsString()
  @IsIn(["student", "parent", "teacher", "other"])
  role: string;

  @ApiProperty({ example: "en", enum: ["en", "ru", "kk"] })
  @IsString()
  @IsIn(["en", "ru", "kk"])
  preferredLanguage: string;
}
