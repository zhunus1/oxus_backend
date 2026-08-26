import { BadRequestException, HttpException, Injectable, InternalServerErrorException, Logger, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { UserEntity } from "../../users/api/dto/user.entity";
import { SignInDto } from "../api/dtos/sign-in.dto";
import { SignUpDto } from "../api/dtos/sign-up.dto";
import { UsersService } from "../../users/service/users.service";
import messages from "src/configs/messages";
import { JsonWebTokenError, JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import { JwtPayloadDto } from "../api/dtos/jwt-payload.dto";
import { Response, Request } from "express";
import { CookieService } from "./cookie.service";
import { OrganisationService } from "src/modules/organisation/service/organisation.service";
import { v4 as uuidv4 } from "uuid";
import * as bcrypt from "bcrypt";
import { AttemptService } from "src/modules/attempt/service/attempt.service";
import { resolveUserIdFromJwtPayload } from "../jwt-user-id.util";

@Injectable()
export class AuthService {
  private entityName = "AuthService";
  private logger = new Logger(AuthService.name);
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private cookieService: CookieService,
    private organisationService: OrganisationService,
    private attemptService: AttemptService,
  ) {}

  async signUp(data: SignUpDto, res: Response) {
    try {
      const user = await this.usersService.signUp(data);

      const payload: JwtPayloadDto = {
        sub: user.id,
        id: user.id,
        firstname: user.firstname,
        lastname: user.lastname,
        roleId: user.roleId,
        roleCode: "STUDENT",
        organisationId: null,
      };

      const accessToken = await this.jwtService.signAsync(payload, { secret: this.configService.get("JWT_SECRET"), expiresIn: "7d" });
      const refreshToken = await this.jwtService.signAsync(payload, {
        secret: this.configService.get<string>("JWT_REFRESH_SECRET"),
        expiresIn: "14d",
      });

      this.cookieService.setAuthCookies(res, { accessToken, refreshToken });

      if (data.attemptAccessToken) {
        await this.attemptService.assignUser(data.attemptAccessToken, user.id);
      }

      return {
        user: new UserEntity(user),
        accessToken: accessToken,
        refreshToken: refreshToken,
      };
    } catch (error: any) {
      if (error instanceof BadRequestException || error instanceof InternalServerErrorException) {
        throw error;
      }
      this.logger.error(`Error while signing up: ${error}`);
      throw new InternalServerErrorException(messages.DATABASE_CREATE_ERROR(this.entityName));
    }
  }

  async checkEmailAvailability(email: string): Promise<{ available: boolean }> {
    const available = await this.usersService.isEmailAvailable(email);
    return { available };
  }

  async signIn(data: SignInDto, res: Response) {
    try {
      const user = await this.usersService.findOne(data.email);

      if (!user) {
        throw new NotFoundException("User not found");
      }
      if (user.deletedAt != null) {
        throw new UnauthorizedException("Incorrect password or email");
      }
      const isMatch = await bcrypt.compare(data.password, user.password);
      if (!isMatch) {
        throw new UnauthorizedException("Incorrect password or email");
      }

      let organisation;
      if (user.organisationId) {
        organisation = await this.organisationService.findById(user.organisationId);
      }
      const payload: JwtPayloadDto = {
        sub: user.id,
        id: user.id,
        firstname: user.firstname,
        lastname: user.lastname,
        roleId: user.role.id,
        roleCode: user.role.code,
        organisation: organisation,
        organisationId: user.organisationId,
      };
      const accessToken = await this.jwtService.signAsync(payload, { secret: this.configService.get("JWT_SECRET"), expiresIn: "7d" });
      const refreshToken = await this.jwtService.signAsync(payload, {
        secret: this.configService.get<string>("JWT_REFRESH_SECRET"),
        expiresIn: "14d",
      });

      this.cookieService.setAuthCookies(res, { accessToken, refreshToken });

      return {
        user: new UserEntity(user),
        accessToken: accessToken,
        refreshToken: refreshToken,
      };
    } catch (error: any) {
      if (error instanceof NotFoundException || error instanceof UnauthorizedException) {
        throw error;
      }
      this.logger.error(`Error while signing in: ${error}`);
      throw new UnauthorizedException(messages.DATABASE_FETCH_ERROR(this.entityName));
    }
  }

  async refreshToken(res: Response, req: Request) {
    try {
      const { refreshToken } = this.cookieService.getAuthCookies(req);

      if (!refreshToken || !refreshToken.trim()) {
        throw new UnauthorizedException("Refresh token not provided");
      }
      await this.jwtService.verifyAsync(refreshToken, { secret: this.configService.get<string>("JWT_REFRESH_SECRET") });
      const decoded = this.jwtService.decode(refreshToken);
      const userId = resolveUserIdFromJwtPayload(decoded);
      if (userId == null) {
        throw new UnauthorizedException("Invalid or expired refresh token");
      }

      const user = await this.usersService.findById(userId);

      if (user.deletedAt != null) {
        throw new UnauthorizedException("Account is disabled");
      }

      const userPayload: JwtPayloadDto = {
        id: user.id,
        sub: user.id,
        firstname: user.firstname,
        lastname: user.lastname,
        roleId: user.role.id,
        roleCode: user.role.code,
        organisationId: user.organisationId,
      };
      const newAccessToken = this.jwtService.sign({ ...userPayload, jti: uuidv4() }, { secret: this.configService.get<string>("JWT_SECRET"), expiresIn: "1d" });
      const newRefreshToken = this.jwtService.sign({ ...userPayload, jti: uuidv4() }, { secret: this.configService.get<string>("JWT_REFRESH_SECRET"), expiresIn: "14d" });
      this.cookieService.setAuthCookies(res, { accessToken: newAccessToken, refreshToken: newRefreshToken });

      return { ...userPayload, accessToken: newAccessToken, refreshToken: newRefreshToken };
    } catch (err: any) {
      if (err instanceof JsonWebTokenError) throw new UnauthorizedException("Invalid or expired refresh token");
      if (err instanceof UnauthorizedException || err instanceof BadRequestException) throw err;
      this.logger.error(`Error while refreshing token: ${err}. Stack: ${err.stack}`);
      throw new InternalServerErrorException(messages.INVALID_REFRESH_TOKEN);
    }
  }

  async me(id: number): Promise<UserEntity> {
    try {
      const user = await this.usersService.findById(id);
      return new UserEntity(user);
    } catch (err: any) {
      if (err instanceof HttpException) throw err;
      this.logger.error(`Error while fetching me for user id ${id}: ${err}`, err?.stack);
      throw new InternalServerErrorException(messages.DATABASE_FETCH_ERROR(this.entityName));
    }
  }

  signOut(res: Response) {
    try {
      this.cookieService.cleanAuthCookies(res);
    } catch (err: any) {
      this.logger.error(`Error while logging out: ${err}. Stack: ${err.stack}`);
      throw new InternalServerErrorException("Logout error");
    }
  }
}
