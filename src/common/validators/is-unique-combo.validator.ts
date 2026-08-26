import { registerDecorator, ValidationArguments, ValidatorConstraint, ValidatorConstraintInterface, ValidationOptions } from "class-validator";
import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../database/prisma.service";
import messages from "../../configs/messages";

@ValidatorConstraint({ async: true })
@Injectable()
export class IsUniqueComboValidator implements ValidatorConstraintInterface {
  private readonly logger = new Logger(IsUniqueComboValidator.name);

  constructor(private readonly prisma: PrismaService) {}

  async validate(_: any, args: ValidationArguments): Promise<boolean> {
    const [rawEntity, fields] = args.constraints as [string, string[]];
    const obj = args.object as Record<string, any>;

    const modelKey = Object.keys(this.prisma).find(key => key.toLowerCase() === rawEntity.toLowerCase());

    if (!modelKey) {
      this.logger.error(`Model '${rawEntity}' not found. Available: ${Object.keys(this.prisma).join(", ")}`);
      return false;
    }

    const model = (this.prisma as any)[modelKey];
    if (!model?.findFirst) {
      this.logger.warn(`Model '${modelKey}' does not support 'findFirst'`);
      return false;
    }

    const where = fields.reduce(
      (acc, field) => {
        acc[field] = obj[field];
        return acc;
      },
      {} as Record<string, any>,
    );

    try {
      const exists = await model.findFirst({ where });
      return !exists;
    } catch (err) {
      this.logger.error(`Validation query failed for '${modelKey}'`, err.stack);
      return false;
    }
  }

  defaultMessage(args: ValidationArguments): string {
    const fields = args.constraints?.[1] ?? [];
    return messages.INVALID_COMBINATIONS?.(fields) || `Combination of [${fields.join(", ")}] must be unique`;
  }
}

export function IsUniqueCombo(entity: string, fields: string[], options?: ValidationOptions) {
  return function (target: any, propertyName: string) {
    registerDecorator({
      name: "IsUniqueCombo",
      target: target.constructor,
      propertyName,
      constraints: [entity, fields],
      options,
      validator: IsUniqueComboValidator,
    });
  };
}
