import { Body, Controller, Get, Param, ParseIntPipe, Post, Put, Query, UseGuards } from "@nestjs/common";
import { UsersService } from "../service/users.service";
import { JwtAuthGuard } from "../../auth/rbac/auth.guard";
import { CreateUserDto } from "./dto/create-user.dto";
import { UpdateUserDto } from "./dto/update-user.dto";
import { UsersQueryDto } from "./dto/users-query.dto";

@UseGuards(JwtAuthGuard)
@Controller("users")
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Post()
  createUser(@Body() dto: CreateUserDto) {
    return this.usersService.create(dto);
  }

  @Put(":id")
  update(@Param("id", ParseIntPipe) id: number, @Body() dto: UpdateUserDto) {
    return this.usersService.updateById(id, dto);
  }

  @Get(":id")
  getById(@Param("id", ParseIntPipe) id: number) {
    return this.usersService.findById(id);
  }

  @Get()
  getMany(@Query() query: UsersQueryDto) {
    return this.usersService.findMany(query);
  }
}
