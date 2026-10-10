import { ExecutionContext, Injectable, NestInterceptor, SetMetadata, type CallHandler } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { UserRequest } from "src/modules/admin/auth/api/dtos/user-request";
import { staffDocumentId, validateStaffDto } from "./dto/staff-document.dto";

const STAFF_INPUT = "staff-document-input";
export const StaffInput = (dto: new () => object, location: "body" | "query" = "body") => SetMetadata(STAFF_INPUT, { dto, location });

/** Validate raw fields before production's global whitelist pipe can silently remove them. */
@Injectable()
export class StaffDocumentInputInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}
  intercept(context: ExecutionContext, next: CallHandler) {
    const input = this.reflector.get<{ dto: new () => object; location: "body" | "query" }>(STAFF_INPUT, context.getHandler());
    const req = context.switchToHttp().getRequest<UserRequest>();
    staffDocumentId(req.params.portraitId);
    if (req.params.documentId !== undefined) staffDocumentId(req.params.documentId);
    if (input) {
      const value = req[input.location];
      const multipart = req.headers["content-type"]?.startsWith("multipart/form-data");
      // Multipart is checked by the same interceptor again, placed after FileInterceptor.
      if (!(input.location === "body" && multipart && value === undefined)) validateStaffDto(input.dto, value, input.location === "query" || multipart ? "decimal" : "number");
    }
    return next.handle();
  }
}
