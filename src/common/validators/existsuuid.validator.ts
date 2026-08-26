import { registerDecorator, ValidationOptions, ValidatorConstraint, ValidatorConstraintInterface, ValidationArguments } from "class-validator";
import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../database/prisma.service";
import messages from "../../configs/messages";
import { validate as isUUID } from "uuid";

@ValidatorConstraint({ async: true })
@Injectable()
export class ExistsUUIDValidator implements ValidatorConstraintInterface {
  private readonly logger = new Logger(ExistsUUIDValidator.name);

  constructor(private readonly prisma: PrismaService) {}

  async validate(value: any, args: ValidationArguments): Promise<boolean> {
    const rawEntityName = args.constraints[0] as string;

    if (!isUUID(value)) {
      this.logger.warn(messages.INVALID_ID(value));
      return false;
    }

    const modelKey = Object.keys(this.prisma).find(key => key.toLowerCase() === rawEntityName.toLowerCase());

    if (!modelKey) {
      this.logger.error(`Model '${rawEntityName}' not found in PrismaService. Available models: ${Object.keys(this.prisma).join(", ")}`);
      return false;
    }

    const model = (this.prisma as any)[modelKey];
    if (!model?.findFirst) {
      this.logger.warn(messages.PRISMA_ENTITY_NOT_FOUND(modelKey));
      return false;
    }

    try {
      const record = await model.findFirst({ where: { id: value } });

      if (!record) {
        this.logger.warn(messages.NOT_FOUND_BY_ID(modelKey, value));
      }

      return !!record;
    } catch (error) {
      this.logger.error(messages.PRISMA_VALIDATION_ERROR(modelKey, "id", value, error.message));
      return false;
    }
  }

  defaultMessage(args: ValidationArguments): string {
    const entityName = args.constraints[0] as string;
    return messages.INVALID_RELATION(entityName, args.value);
  }
}

export function ExistsUUID<T extends string>(entity: T, validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      constraints: [entity],
      validator: ExistsUUIDValidator,
    });
  };
}
