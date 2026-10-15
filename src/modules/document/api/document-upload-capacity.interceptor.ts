import { Injectable, ServiceUnavailableException, type CallHandler, type ExecutionContext, type NestInterceptor } from "@nestjs/common";
import type { Response } from "express";
import { defer, from, lastValueFrom, type Observable } from "rxjs";

export const DOCUMENT_MAX_CONCURRENT_UPLOADS = 4;
let activeUploads = 0;

/** One process-wide budget shared by student/staff create and replacement routes, before Multer. */
@Injectable()
export class DocumentUploadCapacityInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return defer(() => {
      if (activeUploads >= DOCUMENT_MAX_CONCURRENT_UPLOADS) throw new ServiceUnavailableException("Document upload capacity is busy; retry later");
      activeUploads++;
      const response = context.switchToHttp().getResponse<Response>();
      let settled = false;
      let responseDone = response.writableFinished || response.destroyed;
      let released = false;
      const release = () => {
        if (released || !settled || !responseDone) return;
        released = true;
        activeUploads--;
        response.off("finish", onResponseDone);
        response.off("close", onResponseDone);
      };
      const onResponseDone = () => {
        responseDone = true;
        release();
      };
      response.once("finish", onResponseDone);
      response.once("close", onResponseDone);
      // A disconnected client must not free capacity while parsing or persistence still holds its buffer.
      const operation = Promise.resolve()
        .then(() => lastValueFrom(next.handle()))
        .finally(() => {
          settled = true;
          release();
        });
      return from(operation);
    });
  }
}
