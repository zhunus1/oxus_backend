import { PartialType, OmitType } from "@nestjs/mapped-types";
import { CreateProgramDto } from "./create-program.dto";

export class UpdateProgramDto extends PartialType(OmitType(CreateProgramDto, ["organisationId"] as const)) {}
