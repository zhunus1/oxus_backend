import { BadRequestException, CanActivate, ExecutionContext, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "src/database/prisma.service";
import { StudentDocumentAccessService } from "src/common/authorization/student-document-access.service";
import type { UserRequest } from "src/modules/admin/auth/api/dtos/user-request";

/** Guards run before Multer allocates the file buffer. The domain repeats these checks. */
@Injectable()
export class DocumentMutationGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: StudentDocumentAccessService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<UserRequest>();
    const portrait = await this.prisma.studentPortrait.findUnique({ where: { userId: req.user.id }, select: { id: true } });
    if (!portrait) throw new ForbiddenException("Document access denied");
    await this.access.assertPortrait(req.user.id, portrait.id, "self");
    if (req.params.id !== undefined) {
      const id = Number(req.params.id);
      if (typeof req.params.id !== "string" || !/^\d+$/.test(req.params.id) || !Number.isSafeInteger(id) || id <= 0) throw new BadRequestException("Invalid document id");
      const doc = await this.prisma.document.findUnique({ where: { id, deletedAt: null }, select: { studentPortraitId: true } });
      if (!doc) throw new NotFoundException("Document not found");
      if (doc.studentPortraitId !== portrait.id) throw new ForbiddenException("Document access denied");
    }
    return true;
  }
}
