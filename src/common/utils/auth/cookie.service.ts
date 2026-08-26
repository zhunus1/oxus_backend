import { Injectable } from "@nestjs/common";
import { Response, Request } from "express";

@Injectable()
export class CookieService {
  static ACCESS_TOKEN_NAME = "accessToken";
  static REFRESH_TOKEN_NAME = "refreshToken";

  setAuthCookies(res: Response, { accessToken, refreshToken }) {
    const commonOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax" as const,
    };
    res.cookie(CookieService.ACCESS_TOKEN_NAME, accessToken, { ...commonOptions });
    res.cookie(CookieService.REFRESH_TOKEN_NAME, refreshToken, { ...commonOptions });
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
    res.clearCookie(CookieService.ACCESS_TOKEN_NAME, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
    });
    res.clearCookie(CookieService.REFRESH_TOKEN_NAME, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
    });
  }
}
