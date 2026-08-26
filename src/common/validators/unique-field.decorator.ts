import { applyDecorators, SetMetadata, UsePipes } from "@nestjs/common";
import { UniqueFieldsPipe } from "./unique-field.pipe";

export const UNIQUE_FIELDS_KEY = "UNIQUE_FIELDS_KEY";

interface UniqueFieldCheck {
  entity: string;
  field: string;
}

export function UseUniqueFields(checks: UniqueFieldCheck[]) {
  return applyDecorators(SetMetadata(UNIQUE_FIELDS_KEY, checks), UsePipes(UniqueFieldsPipe));
}
