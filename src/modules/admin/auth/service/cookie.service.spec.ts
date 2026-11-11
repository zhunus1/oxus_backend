import { InternalServerErrorException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import type { Response } from "express";
import { CookieService } from "./cookie.service";

describe("Authentication cookie expiration", () => {
  const day = 24 * 60 * 60 * 1000;
  const issuedAt = Date.UTC(2026, 10, 11, 9);
  const jwt = new JwtService({ secret: "cookie-expiration-test-only" });
  const cookie = jest.fn();
  const clearCookie = jest.fn();
  const response = { cookie, clearCookie } as unknown as Response;
  let service: CookieService;
  let now: number;
  let originalNodeEnv: string | undefined;

  beforeEach(() => {
    jest.clearAllMocks();
    now = issuedAt;
    jest.spyOn(Date, "now").mockImplementation(() => now);
    originalNodeEnv = process.env.NODE_ENV;
    service = new CookieService(jwt);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  });

  it("can be resolved with the existing AuthModule providers", async () => {
    const module = await Test.createTestingModule({ providers: [CookieService, JwtService] }).compile();
    try {
      expect(module.get(CookieService)).toBeInstanceOf(CookieService);
    } finally {
      await module.close();
    }
  });

  it.each([
    ["sign-in and sign-up", 7],
    ["refresh", 1],
  ])("keeps %s cookies for their corresponding JWT lifetimes", (_flow, accessDays) => {
    const accessToken = jwt.sign({ sub: 17 }, { expiresIn: Number(accessDays) * 24 * 60 * 60 });
    const refreshToken = jwt.sign({ sub: 17 }, { expiresIn: "14d" });
    process.env.NODE_ENV = "production";

    service.setAuthCookies(response, { accessToken, refreshToken });

    const options = { httpOnly: true, secure: true, sameSite: "lax" };
    expect(cookie).toHaveBeenNthCalledWith(1, "accessToken", accessToken, { ...options, maxAge: Number(accessDays) * day });
    expect(cookie).toHaveBeenNthCalledWith(2, "refreshToken", refreshToken, { ...options, maxAge: 14 * day });
  });

  it("uses remaining lifetime rather than extending a previously issued JWT", () => {
    const accessToken = jwt.sign({ sub: 17 }, { expiresIn: "7d" });
    const refreshToken = jwt.sign({ sub: 17 }, { expiresIn: "14d" });
    const elapsed = 2 * 60 * 60 * 1000 + 375;
    now += elapsed;

    service.setAuthCookies(response, { accessToken, refreshToken });

    expect(cookie).toHaveBeenNthCalledWith(1, "accessToken", accessToken, expect.objectContaining({ maxAge: 7 * day - elapsed }));
    expect(cookie).toHaveBeenNthCalledWith(2, "refreshToken", refreshToken, expect.objectContaining({ maxAge: 14 * day - elapsed }));
  });

  it("expires an already expired token's cookie immediately", () => {
    const accessToken = jwt.sign({ sub: 17 }, { expiresIn: "1d" });
    const refreshToken = jwt.sign({ sub: 17 }, { expiresIn: "14d" });
    now += 2 * day;

    service.setAuthCookies(response, { accessToken, refreshToken });

    expect(cookie).toHaveBeenNthCalledWith(1, "accessToken", accessToken, expect.objectContaining({ maxAge: 0 }));
    expect(cookie).toHaveBeenNthCalledWith(2, "refreshToken", refreshToken, expect.objectContaining({ maxAge: 12 * day }));
  });

  it.each(["accessToken", "refreshToken"] as const)("does not set either cookie if %s has no expiration", tokenName => {
    const tokens = {
      accessToken: jwt.sign({ sub: 17 }, { expiresIn: "7d" }),
      refreshToken: jwt.sign({ sub: 17 }, { expiresIn: "14d" }),
    };
    tokens[tokenName] = jwt.sign({ sub: 17 });

    expect(() => service.setAuthCookies(response, tokens)).toThrow(InternalServerErrorException);
    expect(cookie).not.toHaveBeenCalled();
  });

  it("rejects malformed tokens without setting cookies", () => {
    expect(() => service.setAuthCookies(response, { accessToken: "invalid-token", refreshToken: "invalid-token" })).toThrow(InternalServerErrorException);
    expect(cookie).not.toHaveBeenCalled();
  });

  it("preserves non-production cookie flags", () => {
    process.env.NODE_ENV = "development";
    const accessToken = jwt.sign({ sub: 17 }, { expiresIn: "7d" });
    const refreshToken = jwt.sign({ sub: 17 }, { expiresIn: "14d" });

    service.setAuthCookies(response, { accessToken, refreshToken });

    expect(cookie).toHaveBeenNthCalledWith(1, "accessToken", accessToken, { httpOnly: true, secure: false, sameSite: "lax", maxAge: 7 * day });
    expect(cookie).toHaveBeenNthCalledWith(2, "refreshToken", refreshToken, { httpOnly: true, secure: false, sameSite: "lax", maxAge: 14 * day });
  });

  it("still clears both cookies on sign-out", () => {
    process.env.NODE_ENV = "production";

    service.cleanAuthCookies(response);

    const options = { httpOnly: true, secure: true, sameSite: "lax" };
    expect(clearCookie).toHaveBeenNthCalledWith(1, "accessToken", options);
    expect(clearCookie).toHaveBeenNthCalledWith(2, "refreshToken", options);
  });
});
