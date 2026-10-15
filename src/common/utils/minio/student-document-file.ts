import { BadRequestException } from "@nestjs/common";
import type { MulterOptions } from "@nestjs/platform-express/multer/interfaces/multer-options.interface";
import { isValidStudentDocumentDocx } from "./student-document-docx";

export const STUDENT_DOCUMENT_MAX_BYTES = 50 * 1024 * 1024;
export const STUDENT_DOCUMENT_DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const STUDENT_DOCUMENT_MIME_TYPES = ["application/pdf", "image/jpeg", "image/png", STUDENT_DOCUMENT_DOCX_MIME] as const;
export type StudentDocumentMime = (typeof STUDENT_DOCUMENT_MIME_TYPES)[number];
export const STUDENT_DOCUMENT_DOWNLOAD_MIME_TYPES = STUDENT_DOCUMENT_MIME_TYPES;
export type StudentDocumentDownloadMime = (typeof STUDENT_DOCUMENT_DOWNLOAD_MIME_TYPES)[number];
const downloadExtensions: Record<StudentDocumentDownloadMime, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  [STUDENT_DOCUMENT_DOCX_MIME]: "docx",
};

export function isStudentDocumentDownloadMime(value: unknown): value is StudentDocumentDownloadMime {
  return STUDENT_DOCUMENT_DOWNLOAD_MIME_TYPES.some(mime => mime === value);
}

export function studentDocumentDownloadExtension(mime: StudentDocumentDownloadMime): string {
  return downloadExtensions[mime];
}

// Phase 2B-2 must pass these limits to FileInterceptor before multipart buffering.
export const STUDENT_DOCUMENT_MULTIPART_LIMITS: NonNullable<MulterOptions["limits"]> = Object.freeze({ fileSize: STUDENT_DOCUMENT_MAX_BYTES, files: 1 });

export function isStudentDocumentMime(value: unknown): value is StudentDocumentMime {
  return STUDENT_DOCUMENT_MIME_TYPES.some(mime => mime === value);
}

function validPng(buffer: Buffer): boolean {
  if (!buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return false;
  let offset = 8;
  let hasData = false;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    if (length > buffer.length - offset - 12) return false;
    const type = buffer.toString("latin1", offset + 4, offset + 8);
    if (!/^[A-Za-z]{4}$/.test(type)) return false;
    if (offset === 8) {
      if (type !== "IHDR" || length !== 13 || buffer.readUInt32BE(offset + 8) === 0 || buffer.readUInt32BE(offset + 12) === 0) return false;
    } else if (type === "IHDR") return false;
    if (type === "IDAT" && length > 0) hasData = true;
    offset += length + 12;
    if (type === "IEND") return length === 0 && hasData && offset === buffer.length;
  }
  return false;
}

function validJpeg(buffer: Buffer): boolean {
  if (buffer.length < 4 || buffer.readUInt16BE(0) !== 0xffd8 || buffer.readUInt16BE(buffer.length - 2) !== 0xffd9) return false;
  let offset = 2;
  let hasFrame = false;
  while (offset + 4 <= buffer.length) {
    if (buffer[offset++] !== 0xff) return false;
    while (buffer[offset] === 0xff) offset++;
    const marker = buffer[offset++];
    if (offset + 2 > buffer.length) return false;
    const length = buffer.readUInt16BE(offset);
    if (length < 2 || offset + length > buffer.length - 2) return false;
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      if (length < 8 || buffer.readUInt16BE(offset + 3) === 0 || buffer.readUInt16BE(offset + 5) === 0) return false;
      hasFrame = true;
    }
    if (marker === 0xda) return hasFrame && length >= 6 && offset + length < buffer.length - 2;
    offset += length;
  }
  return false;
}

/** Bounded structural checks, not malware scanning or a full document decoder. */
export function validateStudentDocumentFile(file: Pick<Express.Multer.File, "buffer" | "size" | "mimetype"> | undefined) {
  try {
    if (!file || Array.isArray(file) || !Buffer.isBuffer(file.buffer)) throw new Error();
    const { buffer, size, mimetype } = file;
    if (!buffer.length || buffer.length > STUDENT_DOCUMENT_MAX_BYTES || size !== buffer.length || !isStudentDocumentMime(mimetype)) throw new Error();
    const valid =
      mimetype === STUDENT_DOCUMENT_DOCX_MIME
        ? isValidStudentDocumentDocx(buffer, STUDENT_DOCUMENT_MAX_BYTES)
        : mimetype === "application/pdf"
          ? /^%PDF-(?:1\.[0-7]|2\.0)[\r\n]/.test(buffer.toString("latin1", 0, 12)) && /%%EOF\s*$/.test(buffer.toString("latin1", Math.max(0, buffer.length - 1024)))
          : mimetype === "image/png"
            ? validPng(buffer)
            : validJpeg(buffer);
    if (!valid) throw new Error();
    return { buffer, contentType: mimetype, size: buffer.length };
  } catch {
    // Also sanitizes inaccessible/disk-only buffers and read/getter failures.
    throw new BadRequestException("Provide one non-empty PDF, JPEG, PNG or DOCX document up to 50 MiB with matching content and MIME type");
  }
}
