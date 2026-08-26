import { SetMetadata } from "@nestjs/common";

export const PERMISSIONS_KEY = "permissions";

export const Permissions = (...roles: string[]) => SetMetadata(PERMISSIONS_KEY, roles);
