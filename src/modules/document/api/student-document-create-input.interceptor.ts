import { BadRequestException, ExecutionContext, Injectable, NestInterceptor, type CallHandler } from "@nestjs/common";
import type { Request } from "express";

const allowedFields = new Set(["title", "documentType", "targetProgramId"]);

/** Check bounded raw multipart fields before the global whitelist removes unknown keys. */
@Injectable()
export class StudentDocumentCreateInputInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    const req = context.switchToHttp().getRequest<Request>();
    for (const [name, value] of Object.entries(req.body ?? {})) {
      if (!allowedFields.has(name) || typeof value !== "string") throw new BadRequestException("Invalid document fields");
    }
    return next.handle();
  }
}
