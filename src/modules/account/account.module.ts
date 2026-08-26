import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { AccountController } from "./api/account.controller";
import { AccountService } from "./account.service";

@Module({
  imports: [JwtModule],
  controllers: [AccountController],
  providers: [AccountService],
})
export class AccountModule {}
