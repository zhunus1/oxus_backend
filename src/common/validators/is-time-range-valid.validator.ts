import { ValidatorConstraint, ValidatorConstraintInterface, ValidationArguments } from "class-validator";
import { ExpertScheduleItemDto } from "src/modules/expert-schedule/api/dto/expert-schedule-item.dto";

@ValidatorConstraint({ name: "isTimeRangeValid", async: false })
export class IsTimeRangeValidValidator implements ValidatorConstraintInterface {
  validate(_: unknown, args: ValidationArguments): boolean {
    const dto = args.object as ExpertScheduleItemDto;
    return dto.startMinute < dto.endMinute;
  }

  defaultMessage(): string {
    return "startMinute must be less than endMinute";
  }
}
