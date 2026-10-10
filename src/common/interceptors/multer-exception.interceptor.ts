import { BadRequestException, ExecutionContext, Injectable, NestInterceptor, type CallHandler } from "@nestjs/common";
import { MulterError } from "multer";
import { catchError } from "rxjs";

/** Bridge Multer 2.4 errors not recognized by Nest 11.1's message-based adapter. */
@Injectable()
export class MulterExceptionInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler) {
    return next.handle().pipe(
      catchError((error: unknown) => {
        if (error instanceof MulterError) {
          switch (error.code as string) {
            case "INVALID_FIELD_NAME":
            case "LIMIT_FIELD_NESTING":
            case "LIMIT_FIELD_ARRAY_INDEX":
            case "STREAM_DESTROYED":
              throw new BadRequestException("Invalid multipart input", { cause: error, description: "Bad Request" });
            case "LIMIT_UNEXPECTED_FILE":
              // Preserve Nest's existing public message after Multer renamed it.
              throw new BadRequestException(error.field ? `Unexpected field - ${error.field}` : "Unexpected field", { cause: error, description: "Bad Request" });
          }
        }
        throw error;
      }),
    );
  }
}
