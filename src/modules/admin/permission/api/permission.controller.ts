import { Controller, Get, Param, ParseIntPipe, UsePipes, ValidationPipe } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { PermissionService } from "../service/permission.service";

@ApiTags("Permissions")
@Controller("permission")
@UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
export class PermissionController {
  constructor(private readonly service: PermissionService) {}

  @Get()
  @ApiOperation({ summary: "Get all permissions" })
  @ApiResponse({ status: 200, description: "OK" })
  async findAll() {
    return this.service.findAll();
  }

  @Get(":id")
  @ApiOperation({ summary: "Get permission by ID" })
  @ApiResponse({ status: 200, description: "OK" })
  async findOne(@Param("id", ParseIntPipe) id: number) {
    return this.service.findOne(id);
  }
}
