import { Injectable, InternalServerErrorException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Response, Request } from "express";

@Injectable()
export class CookieService {
  static ACCESS_TOKEN_NAME = "accessToken";
  static REFRESH_TOKEN_NAME = "refreshToken";

  constructor(private readonly jwtService: JwtService) {}

  setAuthCookies(res: Response, { accessToken, refreshToken }: { accessToken: string; refreshToken: string }) {
    const now = Date.now();
    const accessMaxAge = this.tokenMaxAge(accessToken, now);
    const refreshMaxAge = this.tokenMaxAge(refreshToken, now);
    const commonOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax" as const,
    };
    res.cookie(CookieService.ACCESS_TOKEN_NAME, accessToken, { ...commonOptions, maxAge: accessMaxAge });
    res.cookie(CookieService.REFRESH_TOKEN_NAME, refreshToken, { ...commonOptions, maxAge: refreshMaxAge });
  }

  private tokenMaxAge(token: string, now: number): number {
    // AuthService issued these tokens; decoding here only reads their expiration.
    const payload = this.jwtService.decode<{ exp?: number }>(token);
    if (!payload || typeof payload.exp !== "number" || !Number.isSafeInteger(payload.exp)) {
      throw new InternalServerErrorException("Authentication token has no valid expiration");
    }
    return Math.max(0, payload.exp * 1000 - now);
  }

  getAuthCookies(req: Request) {
    const accessToken = req.cookies[CookieService.ACCESS_TOKEN_NAME];
    const refreshToken = req.cookies[CookieService.REFRESH_TOKEN_NAME];

    return {
      accessToken,
      refreshToken,
    };
  }

  cleanAuthCookies(res: Response) {
    const options = {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax" as const,
    };
    res.clearCookie(CookieService.ACCESS_TOKEN_NAME, options);
    res.clearCookie(CookieService.REFRESH_TOKEN_NAME, options);
  }
}
