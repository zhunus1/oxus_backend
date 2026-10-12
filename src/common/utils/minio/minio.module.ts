import { Module } from "@nestjs/common";
import { MinioService } from "./minio.service";
import { UploadService } from "./upload.service";
import { ConfigModule } from "@nestjs/config";
import { StudentDocumentStorageService } from "./student-document-storage.service";

@Module({
  providers: [MinioService, UploadService, StudentDocumentStorageService],
  imports: [ConfigModule],
  exports: [MinioService, UploadService, StudentDocumentStorageService],
})
export class MinioModule {}
