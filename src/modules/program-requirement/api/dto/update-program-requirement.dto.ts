import { PartialType } from "@nestjs/swagger";
import { CreateProgramRequirementDto } from "./create-program-requirement.dto";

export class UpdateProgramRequirementDto extends PartialType(CreateProgramRequirementDto) {}
