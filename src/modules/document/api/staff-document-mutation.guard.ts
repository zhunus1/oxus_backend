import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import type { UserRequest } from "src/modules/admin/auth/api/dtos/user-request";
import { DocumentService } from "../service/document.service";
import { staffDocumentId } from "./dto/staff-document.dto";

/** Runs before Multer allocates a full bounded file; service repeats current DB authorization. */
@Injectable()
export class StaffDocumentMutationGuard implements CanActivate {
  constructor(private readonly documents: DocumentService) {}
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<UserRequest>();
    const portraitId = staffDocumentId(req.params.portraitId);
    if (req.params.documentId !== undefined) await this.documents.staffDetail(req.user.id, portraitId, staffDocumentId(req.params.documentId));
    else await this.documents.assertStaffPortrait(req.user.id, portraitId);
    return true;
  }
}
