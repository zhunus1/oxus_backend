import { CanActivate, ExecutionContext, ForbiddenException, Injectable, Logger, UnauthorizedException } from "@nestjs/common";
import { JsonWebTokenError, JwtService } from "@nestjs/jwt";
import { Reflector } from "@nestjs/core";
import { IS_PUBLIC_KEY } from "./public.decorator";
import { PERMISSIONS_KEY } from "./permissions.decorator";
import { UserRequest } from "../api/dtos/user-request";
import { PrismaService } from "src/database/prisma.service";
import { resolveUserIdFromJwtPayload } from "../jwt-user-id.util";

@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name);
  constructor(
    private reflector: Reflector,
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<UserRequest>();
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()]);

    if (isPublic) {
      return true;
    }

    let access = req.cookies?.accessToken;
    if (!access) {
      const header = req.headers.authorization;
      if (header?.startsWith("Bearer ")) access = header.slice(7);
    }
    if (!access || !access.trim()) {
      throw new UnauthorizedException("Token not provided");
    }
    try {
      const payload = this.jwtService.verify(access, { secret: process.env.JWT_SECRET });
      const userId = resolveUserIdFromJwtPayload(payload);
      if (userId == null) {
        throw new UnauthorizedException("Invalid or expired token");
      }

      const userRow = await this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          deletedAt: true,
          role: {
            select: {
              code: true,
              permissions: { select: { code: true } },
            },
          },
        },
      });
      if (!userRow || userRow.deletedAt != null) {
        throw new UnauthorizedException("Account is disabled");
      }

      req.user = payload;
      req.user.id = userId;
      req.user.sub = userId;
      if (userRow.role?.code) {
        req.user.roleCode = userRow.role.code;
      }

      const userPermissionCodes = userRow.role?.permissions.map(permission => permission.code) ?? [];

      const permissions = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [context.getHandler(), context.getClass()]) || [];
      if (permissions.length >= 1) {
        const hasRequiredPermission: boolean = permissions.some(requiredPermission => userPermissionCodes.includes(requiredPermission));

        if (!hasRequiredPermission) {
          throw new ForbiddenException(`${permissions.toString()} permissions required`);
        }
      }

      return true;
    } catch (err: any) {
      if (err instanceof UnauthorizedException || err instanceof ForbiddenException) throw err;
      if (err instanceof JsonWebTokenError) throw new UnauthorizedException("Invalid or expired token");
      this.logger.error(err);
      throw new UnauthorizedException("Invalid or expired token");
    }
  }
}
