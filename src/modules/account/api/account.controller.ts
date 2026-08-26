import { Body, ClassSerializerInterceptor, Controller, HttpCode, HttpStatus, Patch, Post, Req, UseGuards, UseInterceptors } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "src/modules/admin/auth/rbac/auth.guard";
import type { UserRequest } from "src/modules/admin/auth/api/dtos/user-request";
import { UserEntity } from "src/modules/admin/users/api/dto/user.entity";
import { AccountService } from "../account.service";
import { UpdateAccountProfileDto } from "./dto/update-account-profile.dto";
import { ChangeAccountPasswordDto } from "./dto/change-account-password.dto";

@ApiTags("Account")
@ApiBearerAuth()
@Controller("account")
@UseGuards(JwtAuthGuard)
@UseInterceptors(ClassSerializerInterceptor)
export class AccountController {
  constructor(private readonly accountService: AccountService) {}

  @ApiOperation({ summary: "Update the authenticated user's profile" })
  @Patch("me")
  async patchMe(@Req() req: UserRequest, @Body() dto: UpdateAccountProfileDto): Promise<UserEntity> {
    return this.accountService.updateProfile(req.user.id, dto);
  }

  @ApiOperation({ summary: "Change the authenticated user's password" })
  @Post("password")
  @HttpCode(HttpStatus.NO_CONTENT)
  async changePassword(@Req() req: UserRequest, @Body() dto: ChangeAccountPasswordDto): Promise<void> {
    await this.accountService.changePassword(req.user.id, dto);
  }
}
