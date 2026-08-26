import { registerDecorator, ValidationOptions, ValidatorConstraint, ValidatorConstraintInterface, ValidationArguments } from "class-validator";
import { PrismaService } from "../../database/prisma.service";
import messages from "../../configs/messages";
import { Logger } from "@nestjs/common";

@ValidatorConstraint({ async: true })
export class ExistsValidator implements ValidatorConstraintInterface {
  private readonly logger = new Logger(ExistsValidator.name);
  constructor(private readonly prisma: PrismaService) {}

  async validate(value: any, args: ValidationArguments): Promise<boolean> {
    const rawEntity = args.constraints[0] as string;
    const id = Number(value);

    if (isNaN(id) || !Number.isInteger(id) || id <= 0) {
      return true;
    }

    const keys = Object.keys(this.prisma);
    const match = keys.find(key => key.toLowerCase() === rawEntity.toLowerCase());
    if (!match || !(this.prisma as any)[match]?.findFirst) {
      return false;
    }

    try {
      const record = await (this.prisma as any)[match].findFirst({ where: { id } });
      return !!record;
    } catch (error) {
      this.logger.error(messages.INTERNAL_ERROR("Exists Validator"), error);
      return false;
    }
  }

  defaultMessage(args: ValidationArguments): string {
    const [entity] = args.constraints as [string];
    const entityName = entity.charAt(0).toUpperCase() + entity.slice(1);
    const id = args.value;
    return messages.INVALID_RELATION(entityName, Number.isInteger(id) ? id : "Unknown");
  }
}

export function Exists<T extends string>(entity: T, validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    const finalValidationOptions: ValidationOptions = {
      ...validationOptions,
      message: validationOptions?.message ?? undefined,
    };

    registerDecorator({
      target: object.constructor,
      propertyName: propertyName,
      options: finalValidationOptions,
      constraints: [entity],
      validator: ExistsValidator,
    });
  };
}
export function ExistsEach<T extends string>(entity: T, validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: { ...validationOptions, each: true, message: validationOptions?.message ?? undefined },
      constraints: [entity],
      validator: ExistsValidator,
    });
  };
}
