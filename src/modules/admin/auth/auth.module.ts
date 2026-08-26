import { Module } from "@nestjs/common";
import { AuthService } from "./service/auth.service";
import { AuthController } from "./api/auth.controller";
import { PrismaService } from "src/database/prisma.service";
import { JwtService } from "@nestjs/jwt";
import { CookieService } from "./service/cookie.service";
import { OrganisationModule } from "src/modules/organisation/organisation.module";
import { ConfigModule } from "@nestjs/config";
import { AttemptModule } from "src/modules/attempt/attempt.module";
import { UsersModule } from "../users/users.module";

@Module({
  providers: [AuthService, JwtService, PrismaService, CookieService],
  controllers: [AuthController],
  imports: [OrganisationModule, ConfigModule, AttemptModule, UsersModule],
})
export class AuthModule {}
