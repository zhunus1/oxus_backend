import { Module } from "@nestjs/common";
import { UsersService } from "./service/users.service";
import { UsersRepository } from "./repository/users.repository";
import { UsersController } from "./api/users.controller";
import { PrismaService } from "src/database/prisma.service";
import { JwtService } from "@nestjs/jwt";
import { UserJourneyModule } from "src/modules/user-journey/user-journey.module";

@Module({
  imports: [UserJourneyModule],
  providers: [UsersService, UsersRepository, JwtService, PrismaService],
  controllers: [UsersController],
  exports: [UsersService],
})
export class UsersModule {}
