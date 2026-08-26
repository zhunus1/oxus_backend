import { Controller, Post, Body, HttpCode, Get, Query, UseGuards, Req, Res, UseInterceptors, ClassSerializerInterceptor } from "@nestjs/common";
import { AuthService } from "../service/auth.service";
import { SignInDto } from "../api/dtos/sign-in.dto";
import { SignUpDto } from "../api/dtos/sign-up.dto";
import { CheckEmailQueryDto } from "../api/dtos/check-email-query.dto";
import { ApiOperation } from "@nestjs/swagger";
import { JwtAuthGuard } from "../rbac/auth.guard";
import { Public } from "../rbac/public.decorator";
import type { Response, Request } from "express";
import type { UserRequest } from "./dtos/user-request";

@Controller("auth")
@UseInterceptors(ClassSerializerInterceptor)
export class AuthController {
  constructor(private authService: AuthService) {}

  @ApiOperation({ description: "Me" })
  @Get("me")
  @UseGuards(JwtAuthGuard)
  me(@Req() req: UserRequest) {
    return this.authService.me(req.user.id);
  }

  @ApiOperation({ description: "Sign in" })
  @Post("sign-in")
  @HttpCode(200)
  async signIn(@Body() dto: SignInDto, @Res({ passthrough: true }) res: Response) {
    return this.authService.signIn(dto, res);
  }

  @ApiOperation({ description: "Sign up" })
  @Post("sign-up")
  @HttpCode(201)
  async signUp(@Body() dto: SignUpDto, @Res({ passthrough: true }) res: Response) {
    return this.authService.signUp(dto, res);
  }

  @Public()
  @ApiOperation({ description: "Check if an email is available for registration" })
  @Get("check-email")
  @HttpCode(200)
  checkEmail(@Query() query: CheckEmailQueryDto) {
    return this.authService.checkEmailAvailability(query.email);
  }

  @Post("refresh-token")
  @HttpCode(200)
  async refreshToken(@Res({ passthrough: true }) res: Response, @Req() req: Request) {
    return this.authService.refreshToken(res, req);
  }

  @Post("sign-out")
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  signOut(@Res({ passthrough: true }) res: Response) {
    return this.authService.signOut(res);
  }
}
