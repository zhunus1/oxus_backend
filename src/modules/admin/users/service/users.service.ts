import { Injectable, InternalServerErrorException, Logger, NotFoundException, BadRequestException } from "@nestjs/common";
import { UsersRepository } from "../repository/users.repository";
import messages from "src/configs/messages";
import { User } from "generated/prisma/client";
import { CreateUserDto } from "../api/dto/create-user.dto";
import { UpdateUserDto } from "../api/dto/update-user.dto";
import { UsersQueryDto } from "../api/dto/users-query.dto";
import { SignUpDto } from "../../auth/api/dtos/sign-up.dto";
import * as bcrypt from "bcrypt";

import { UserJourneyLogService } from "src/modules/user-journey/user-journey-log.service";
import { USER_JOURNEY_EVENT } from "src/modules/user-journey/user-journey.constants";

@Injectable()
export class UsersService {
  private entityName = "Users";
  private logger = new Logger(UsersService.name);
  constructor(
    private usersRepo: UsersRepository,
    private readonly userJourneyLog: UserJourneyLogService,
  ) {}

  async findById(id: number) {
    try {
      const user = await this.usersRepo.findById(id);
      if (!user) {
        throw new NotFoundException("User not found");
      }
      return user;
    } catch (error: any) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(`Error while fetching user with id: ${id}: ${error}`);
      throw new InternalServerErrorException(messages.DATABASE_FETCH_ERROR(this.entityName));
    }
  }

  async findOne(email: string) {
    try {
      const user = await this.usersRepo.findOne(email);
      if (!user) {
        throw new NotFoundException("User not found");
      }
      return user;
    } catch (error: any) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(`Error while fetching user with email: ${email}: ${error}`);
      throw new InternalServerErrorException(messages.DATABASE_FETCH_ERROR(this.entityName));
    }
  }

  /** Returns true when no active user owns this email (case-insensitive). */
  async isEmailAvailable(email: string): Promise<boolean> {
    const normalized = email.trim().toLowerCase();
    const user = await this.usersRepo.findByEmailInsensitive(normalized);
    if (!user) return true;
    return user.deletedAt != null;
  }

  async findMany(query: UsersQueryDto) {
    try {
      return await this.usersRepo.findMany(query);
    } catch (error: any) {
      this.logger.error(`Error while fetching users: ${error}`);
      throw new InternalServerErrorException(messages.DATABASE_FETCH_ERROR(this.entityName));
    }
  }

  async updateById(id: number, data: UpdateUserDto) {
    try {
      return this.usersRepo.update(id, data);
    } catch (error: any) {
      this.logger.error(`Error while updating user: ${error}`);
      throw new InternalServerErrorException(messages.DATABASE_UPDATE_ERROR_ENTITY(this.entityName));
    }
  }

  async create(data: CreateUserDto) {
    try {
      const hashedPassword = await bcrypt.hash(data.password, 10);
      data.password = hashedPassword;
      return this.usersRepo.create(data);
    } catch (error: any) {
      this.logger.error(`Error while creting user: ${error}`);
      throw new InternalServerErrorException(messages.DATABASE_CREATE_ERROR(this.entityName));
    }
  }

  async signUp(data: SignUpDto): Promise<User> {
    try {
      const studentRole = await this.usersRepo.findRoleByCode("STUDENT");
      if (!studentRole) {
        throw new InternalServerErrorException("Role STUDENT not found");
      }

      const existingUser = await this.usersRepo.findByEmailOrPhone(data.email, data.phoneNumber ?? null);
      if (existingUser) {
        throw new BadRequestException("User with this email or phone number already exists");
      }

      const hashedPassword = await bcrypt.hash(data.password, 10);
      const termsAcceptedAtDate = data.termsAcceptedAt ? new Date(data.termsAcceptedAt) : data.hasAcceptedTerms ? new Date() : null;

      const user = await this.usersRepo.signUpUser(
        {
          ...data,
          password: hashedPassword,
          termsAcceptedAt: termsAcceptedAtDate,
        },
        studentRole.id,
      );
      void this.userJourneyLog.logEvent(user.id, USER_JOURNEY_EVENT.REGISTRATION, {
        source: "sign_up",
      });
      return user;
    } catch (error: any) {
      if (error instanceof BadRequestException || error instanceof InternalServerErrorException) {
        throw error;
      }
      this.logger.error(`Error while signing up user: ${error}`);
      throw new InternalServerErrorException(messages.DATABASE_CREATE_ERROR(this.entityName));
    }
  }
}
