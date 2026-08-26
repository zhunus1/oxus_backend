import { Prisma } from "generated/prisma/client";

export interface Role {
  id: number;
  name: string;
  code: string;
  deleted_at: Date | null;
}

export type RoleWithPermissions = Prisma.RoleGetPayload<{ include: { permissions: true } }>;
