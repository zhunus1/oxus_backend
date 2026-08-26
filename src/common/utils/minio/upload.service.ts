// src/common/utils/minio/upload.service.ts
import { Injectable, BadRequestException, Logger } from "@nestjs/common";
import { MinioService } from "./minio.service";
import messages from "src/configs/messages";
import { Express } from "express";

interface UploadBufferParams {
  buffer: Buffer;
  filePath: string;
  mimeType: string;
  originalName?: string;
}

@Injectable()
export class UploadService {
  private readonly logger = new Logger(UploadService.name);

  constructor(private readonly minioService: MinioService) {}

  async uploadFile(directory: string, file: Express.Multer.File): Promise<string> {
    if (!file) {
      throw new BadRequestException(messages.NO_FILE);
    }

    if (file.size === 0) {
      throw new BadRequestException(messages.FILE_EMPTY);
    }

    const recoveredName = Buffer.from(file.originalname, "latin1").toString("utf-8");
    const fileName = `${Date.now()}-${recoveredName}`;

    const fileUrl = await this.minioService.uploadFile(directory, file.buffer, fileName, file.mimetype);

    return fileUrl;
  }

  async uploadBuffer(params: UploadBufferParams): Promise<string> {
    const { buffer, filePath, mimeType } = params;

    if (!buffer || buffer.length === 0) {
      throw new BadRequestException(messages.FILE_EMPTY);
    }

    const normalized = filePath.replace(/^\/+/, "");
    const idx = normalized.lastIndexOf("/");

    const directory = idx >= 0 ? normalized.substring(0, idx) : "";
    const fileName = idx >= 0 ? normalized.substring(idx + 1) : normalized;

    if (!fileName) {
      throw new BadRequestException("Некорректный путь filePath для загрузки файла");
    }

    const url = await this.minioService.uploadFile(directory, buffer, fileName, mimeType);

    return url;
  }
}
