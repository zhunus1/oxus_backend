import { Controller, Get, Post, Put, Param, Body, ParseIntPipe } from "@nestjs/common";
import { RoleService } from "../service/role.service";
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiBody } from "@nestjs/swagger";
import { CreateRoleDto } from "./dtos/create-role.dto";
import { UpdateRoleDto } from "./dtos/update-role.dto";

@ApiTags("Roles")
@Controller("roles")
export class RoleController {
  constructor(private readonly roleService: RoleService) {}

  @Post()
  @ApiOperation({ summary: "Create a new role" })
  @ApiResponse({ status: 201, description: "Role successfully created" })
  @ApiBody({ type: CreateRoleDto })
  async create(@Body() dto: CreateRoleDto) {
    return await this.roleService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: "Get all roles" })
  @ApiResponse({ status: 200, description: "List of roles returned" })
  async findAll() {
    return await this.roleService.findAll();
  }

  @Get(":id")
  @ApiOperation({ summary: "Get a role by ID" })
  @ApiParam({ name: "id", type: Number })
  @ApiResponse({ status: 200, description: "Role found" })
  async findOne(@Param("id", ParseIntPipe) id: number) {
    return await this.roleService.findOne(id);
  }

  @Put(":id")
  @ApiOperation({ summary: "Update a role by ID" })
  @ApiParam({ name: "id", type: Number })
  @ApiBody({ type: UpdateRoleDto })
  @ApiResponse({ status: 200, description: "Role updated" })
  async update(@Param("id", ParseIntPipe) id: number, @Body() dto: UpdateRoleDto) {
    return await this.roleService.update(id, dto);
  }
}
