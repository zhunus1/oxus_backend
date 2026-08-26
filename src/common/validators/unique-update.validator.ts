import { registerDecorator, ValidationOptions, ValidatorConstraint, ValidatorConstraintInterface, ValidationArguments } from "class-validator";
import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../database/prisma.service";
import messages from "src/configs/messages";

@ValidatorConstraint({ async: true })
@Injectable()
export class UniqueForUpdateValidator implements ValidatorConstraintInterface {
  private readonly logger = new Logger(UniqueForUpdateValidator.name);

  constructor(private readonly prisma: PrismaService) {}

  async validate(value: any, args: ValidationArguments): Promise<boolean> {
    const [rawEntity, field, idField] = args.constraints as [string, string, string?];
    const object = args.object as Record<string, any>;

    const modelKey = Object.keys(this.prisma).find(key => key.toLowerCase() === rawEntity.toLowerCase());

    if (!modelKey) {
      this.logger.warn(messages.PRISMA_ENTITY_NOT_FOUND(rawEntity));
      return false;
    }

    const model = (this.prisma as any)[modelKey];

    const id = object[idField!] ?? object.id;
    if (!id) {
      this.logger.warn(`[${rawEntity}] Update validator: missing id from object`);
      return false;
    }

    try {
      const whereCondition: Record<string, any> = {
        [field]: value,
        id: { not: id },
      };

      const existing = await model.findFirst({ where: whereCondition });
      return !existing;
    } catch (err) {
      this.logger.error(messages.PRISMA_VALIDATION_ERROR(modelKey, field, value, err.message));
      return false;
    }
  }

  defaultMessage(args: ValidationArguments): string {
    const [entityName, field] = args.constraints as [string, string];
    return messages.UNIQUE_CONSTRAINT_FAILED(entityName, field, args.value);
  }
}

export function UniqueForUpdate<T extends string>(entity: T, field: string, idField: string, validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      constraints: [entity, field, idField],
      validator: UniqueForUpdateValidator,
    });
  };
}
