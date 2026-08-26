import { Injectable, PipeTransform, BadRequestException, Inject, Scope } from "@nestjs/common";
import { REQUEST, Reflector } from "@nestjs/core";
import { PrismaService } from "../../database/prisma.service";
import type { Request } from "express";
import { UNIQUE_FIELDS_KEY } from "./unique-field.decorator";
import messages from "../../configs/messages";

interface UniqueFieldCheck {
  entity: string;
  field: string;
}

@Injectable({ scope: Scope.REQUEST })
export class UniqueFieldsPipe implements PipeTransform {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REQUEST) private readonly request: Request,
    private readonly reflector: Reflector,
  ) {}

  async transform(value: any) {
    if (!this.request) {
      return value;
    }

    // 🔍 Получаем handler для Reflector'а
    const handler = this.request.route?.stack?.[this.request.route.stack.length - 1]?.handle;
    if (!handler) {
      return value;
    }

    const checks: UniqueFieldCheck[] = this.reflector.get<UniqueFieldCheck[]>(UNIQUE_FIELDS_KEY, handler);
    if (!checks || checks.length === 0) {
      return value;
    }

    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-expect-error
    const idParam: string = this.request?.params?.id;
    let id: number | string | undefined = undefined;

    if (idParam) {
      if (/^\d+$/.test(idParam)) {
        id = parseInt(idParam, 10);
      } else {
        id = idParam;
      }
    }

    await Promise.all(
      checks.map(async check => {
        const modelKey = Object.keys(this.prisma).find(key => key.toLowerCase() === check.entity.toLowerCase());

        if (!modelKey) {
          throw new BadRequestException(`Model "${check.entity}" not found in PrismaService`);
        }

        const model = (this.prisma as any)[modelKey];
        const fieldValue = value?.[check.field];

        if (fieldValue === undefined || fieldValue === null) {
          return;
        }

        const whereCondition: any = {
          [check.field]: fieldValue,
        };

        if (id !== undefined) {
          whereCondition["id"] = { not: id };
        }

        const existing = await model.findFirst({ where: whereCondition });

        if (existing) {
          throw new BadRequestException(messages.ALREADY_USED(check.field));
        }
      }),
    );

    return value;
  }
}
