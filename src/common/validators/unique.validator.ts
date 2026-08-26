import { registerDecorator, ValidationOptions, ValidatorConstraint, ValidatorConstraintInterface, ValidationArguments } from "class-validator";
import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../database/prisma.service";
import messages from "../../configs/messages";

@ValidatorConstraint({ async: true })
@Injectable()
export class UniqueValidator implements ValidatorConstraintInterface {
  private readonly logger = new Logger(UniqueValidator.name);

  constructor(private readonly prisma: PrismaService) {}

  async validate(value: any, args: ValidationArguments): Promise<boolean> {
    const [rawEntity, field] = args.constraints as [string, string];

    const modelKey = Object.keys(this.prisma).find(key => key.toLowerCase() === rawEntity.toLowerCase());

    if (!modelKey) {
      this.logger.warn(messages.PRISMA_ENTITY_NOT_FOUND(rawEntity));
      return false;
    }

    const model = (this.prisma as any)[modelKey];

    const prismaAny = this.prisma as any;

    const hasDeletedAt = prismaAny._dmmf?.modelMap?.[modelKey]?.fields?.some((f: any) => f.name === "deleted_at") ?? false;

    try {
      const whereClause: any = { [field]: value };
      if (hasDeletedAt) {
        whereClause.deleted_at = null;
      }

      const existingRecord = await model.findFirst({
        where: whereClause,
      });

      return !existingRecord;
    } catch (error) {
      this.logger.error(messages.PRISMA_VALIDATION_ERROR(modelKey, field, value, error.message));
      return false;
    }
  }

  defaultMessage(args: ValidationArguments): string {
    const [entityName, field] = args.constraints as [string, string];
    return messages.UNIQUE_CONSTRAINT_FAILED(entityName, field, args.value);
  }
}

export function Unique<T extends string>(entity: T, field: string, validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      constraints: [entity, field],
      validator: UniqueValidator,
    });
  };
}
