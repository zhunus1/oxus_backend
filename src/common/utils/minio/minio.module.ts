import { Module } from "@nestjs/common";
import { MinioService } from "./minio.service";
import { UploadService } from "./upload.service";
import { ConfigModule } from "@nestjs/config";

@Module({
  providers: [MinioService, UploadService],
  imports: [ConfigModule],
  exports: [MinioService, UploadService],
})
export class MinioModule {}
