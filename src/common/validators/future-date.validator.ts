import { ValidatorConstraint, ValidatorConstraintInterface } from "class-validator";
import messages from "../../configs/messages";

@ValidatorConstraint({ async: false })
export class FutureDateValidator implements ValidatorConstraintInterface {
  validate(value: string): boolean {
    const inputDate = new Date(value);
    const now = new Date();
    return inputDate > now;
  }

  defaultMessage(): string {
    return messages.FUTURE_DATE("Date Time");
  }
}
