import { Organisation } from "generated/prisma/browser";

export class JwtPayloadDto {
  sub: number;
  id: number;
  firstname: string;
  lastname: string;
  roleId: number;
  roleCode: string;
  organisation?: Organisation | null;
  organisationId?: number | null;
}
