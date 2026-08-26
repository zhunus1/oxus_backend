// src/common/validators/exactly-one-of.validator.ts
/* eslint-disable @typescript-eslint/no-unsafe-function-type */
import { registerDecorator, ValidationOptions, ValidationArguments } from "class-validator";

export function ExactlyOneOfClass(fields: string[], validationOptions?: ValidationOptions) {
  return function (constructor: Function) {
    registerDecorator({
      name: "ExactlyOneOfClass",
      target: constructor,
      // propertyName undefined => class-level decorator
      propertyName: undefined as unknown as string,
      constraints: [fields],
      options: validationOptions,
      validator: {
        validate(_: unknown, args: ValidationArguments) {
          const obj = args.object as Record<string, unknown>;
          const keys = (args.constraints?.[0] as string[]) ?? [];
          const defined = keys.filter(k => obj[k] !== undefined);
          return defined.length === 1;
        },
        defaultMessage(args: ValidationArguments) {
          const keys = (args.constraints?.[0] as string[]) ?? [];
          return `Exactly one of the following fields must be provided: ${keys.join(", ")}`;
        },
      },
    });
  };
}
