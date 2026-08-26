import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ROLES_KEY } from "./roles.decorator";
import { UserRequest } from "../api/dtos/user-request";

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [context.getHandler(), context.getClass()]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const req = context.switchToHttp().getRequest<UserRequest>();
    const user = req.user;

    if (!user || !user.roleCode) {
      throw new ForbiddenException("Access denied");
    }

    const hasRole = requiredRoles.some(role => role.toUpperCase() === user.roleCode.toUpperCase());

    if (!hasRole) {
      throw new ForbiddenException(`Requires one of roles: ${requiredRoles.join(", ")}`);
    }

    return true;
  }
}
