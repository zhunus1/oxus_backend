import { ServiceUnavailableException } from "@nestjs/common";
import type { Response } from "express";
import type { Readable } from "node:stream";
import type { UserRequest } from "src/modules/admin/auth/api/dtos/user-request";
import type { StudentDocumentMime } from "src/common/utils/minio/student-document-file";

/** Shared authenticated binary responder; caller performs portrait/document authorization. */
export async function streamDocumentResponse(
  req: UserRequest,
  res: Response,
  id: number,
  read: (signal: AbortSignal) => Promise<{ stream: Readable; contentType: StudentDocumentMime; size: number }>,
) {
  const abort = new AbortController();
  let stream: Readable | undefined;
  const cleanup = () => {
    clearTimeout(deadline);
    abort.abort();
    stream?.destroy();
    req.off("aborted", cleanup);
    res.off("close", cleanup);
    res.off("finish", cleanup);
  };
  const fail = () => {
    if (res.destroyed || res.writableEnded) return;
    if (res.headersSent) res.destroy();
    else {
      for (const header of ["Content-Length", "Content-Disposition", "Content-Type"]) res.removeHeader(header);
      res.status(503).json({ statusCode: 503, message: "Document storage is unavailable" });
    }
    cleanup();
  };
  // Bound both metadata requests and stalled/unfinished response transmission.
  const deadline = setTimeout(() => {
    fail();
  }, 30_000);
  deadline.unref();
  req.once("aborted", cleanup);
  res.once("close", cleanup);
  res.once("finish", cleanup);
  try {
    const result = await read(abort.signal);
    stream = result.stream;
    if (abort.signal.aborted || req.aborted || res.destroyed) {
      cleanup();
      return;
    }
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="document-${id}.${result.contentType === "application/pdf" ? "pdf" : result.contentType === "image/png" ? "png" : "jpg"}"`,
    );
    res.setHeader("Content-Type", result.contentType);
    res.setHeader("Content-Length", result.size);
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    stream.once("error", fail);
    stream.pipe(res);
  } catch (error) {
    cleanup();
    if (res.destroyed || res.writableEnded) return;
    if (res.headersSent) {
      res.destroy();
      return;
    }
    if (abort.signal.reason?.name === "TimeoutError") throw new ServiceUnavailableException("Document storage is unavailable");
    throw error;
  }
}
