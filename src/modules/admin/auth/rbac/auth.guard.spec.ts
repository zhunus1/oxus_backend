import { ForbiddenException, UnauthorizedException, type ExecutionContext } from "@nestjs/common";
import type { Reflector } from "@nestjs/core";
import type { JwtService } from "@nestjs/jwt";
import type { PrismaService } from "src/database/prisma.service";
import { JwtAuthGuard } from "./auth.guard";
import { IS_PUBLIC_KEY } from "./public.decorator";
import { PERMISSIONS_KEY } from "./permissions.decorator";

jest.mock("src/database/prisma.service", () => ({ PrismaService: class {} }));

describe("JwtAuthGuard RBAC", () => {
  const request: {
    cookies: Record<string, string>;
    headers: { authorization?: string };
    user?: Record<string, unknown>;
  } = {
    cookies: {},
    headers: { authorization: "Bearer valid-token" },
  };
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
  } as unknown as ExecutionContext;
  const getAllAndOverride = jest.fn();
  const reflector = { getAllAndOverride } as unknown as Reflector;
  const verify = jest.fn();
  const jwt = { verify } as unknown as JwtService;
  const findUnique = jest.fn();
  const prisma = { user: { findUnique } } as unknown as PrismaService;
  const guard = new JwtAuthGuard(reflector, jwt, prisma);

  beforeEach(() => {
    jest.clearAllMocks();
    request.cookies = {};
    request.headers = { authorization: "Bearer valid-token" };
    delete request.user;
    verify.mockReturnValue({ sub: "17", firstname: "Sales", lastname: "Manager" });
    findUnique.mockResolvedValue({
      deletedAt: null,
      role: { code: "SALES_MANAGER", permissions: [{ code: "SALES_LEADS_MANAGE_OWN" }] },
    });
    getAllAndOverride.mockImplementation(key => {
      if (key === IS_PUBLIC_KEY) return false;
      if (key === PERMISSIONS_KEY) return ["SALES_LEADS_MANAGE_OWN"];
      return undefined;
    });
  });

  it("loads current permissions from the database and normalizes the request user id", async () => {
    await expect(guard.canActivate(context)).resolves.toBe(true);

    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 17 },
        select: expect.objectContaining({ role: expect.any(Object) }),
      }),
    );
    expect(request.user).toEqual(expect.objectContaining({ id: 17, sub: 17, roleCode: "SALES_MANAGER" }));
  });

  it("returns 403 when the authenticated role lacks the endpoint permission", async () => {
    getAllAndOverride.mockImplementation(key => (key === PERMISSIONS_KEY ? ["SALES_LEADS_ACCEPT"] : false));

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("rejects deleted users even when their JWT is still valid", async () => {
    findUnique.mockResolvedValue({ deletedAt: new Date(), role: { code: "SALES_MANAGER", permissions: [] } });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
