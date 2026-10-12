import { Module } from "@nestjs/common";
import { PrismaModule } from "src/database/prisma.module";
import { StudentDocumentAccessService } from "./student-document-access.service";

@Module({ imports: [PrismaModule], providers: [StudentDocumentAccessService], exports: [StudentDocumentAccessService] })
export class StudentDocumentAccessModule {}
