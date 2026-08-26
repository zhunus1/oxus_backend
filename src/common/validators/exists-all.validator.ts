import { registerDecorator, ValidationOptions, ValidatorConstraint, ValidatorConstraintInterface, ValidationArguments } from "class-validator";
import { PrismaService } from "../../database/prisma.service";
import { Injectable, Logger } from "@nestjs/common";
import messages from "../../configs/messages";

@Injectable()
@ValidatorConstraint({ async: true })
export class ExistsAllValidator implements ValidatorConstraintInterface {
  private readonly logger = new Logger(ExistsAllValidator.name);
  private missing: number[] = [];

  constructor(private readonly prisma: PrismaService) {}

  async validate(value: any, args: ValidationArguments): Promise<boolean> {
    if (!Array.isArray(value) || value.length === 0) {
      this.missing = [];
      return true;
    }

    const rawEntity = args.constraints[0] as string;

    const keys = Object.keys(this.prisma);
    const match = keys.find(k => k.toLowerCase() === rawEntity.toLowerCase());

    if (!match || !(this.prisma as any)[match]?.findMany) {
      this.missing = [];
      return false;
    }

    const ids = value.map(v => (typeof v === "number" ? v : Number(v))).filter(n => Number.isInteger(n) && n > 0);

    if (ids.length === 0) {
      this.missing = [];
      return true;
    }

    try {
      const repo = (this.prisma as any)[match];
      const rows: Array<{ id: number }> = await repo.findMany({
        where: { id: { in: ids } },
        select: { id: true },
      });

      const found = new Set(rows.map(r => r.id));
      this.missing = ids.filter(id => !found.has(id));

      return this.missing.length === 0;
    } catch (err) {
      this.logger.error(messages.INTERNAL_ERROR("ExistsAll Validator"), err);
      this.missing = [];
      return false;
    }
  }

  defaultMessage(args: ValidationArguments): string {
    const [entity] = args.constraints as [string];
    const entityName = entity.charAt(0).toUpperCase() + entity.slice(1);

    const list = this.missing.length > 0 ? this.missing.join(", ") : Array.isArray(args.value) ? String(args.value) : "Unknown";

    return messages.INVALID_RELATION_LIST(entityName, list);
  }
}

export function ExistsAll<T extends string>(entity: T, validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      constraints: [entity],
      validator: ExistsAllValidator,
    });
  };
}
