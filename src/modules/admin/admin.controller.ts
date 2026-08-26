import { BadRequestException, Body, Controller, Get, NotFoundException, Param, ParseIntPipe, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { Prisma } from "generated/prisma/client";
import { PrismaService } from "src/database/prisma.service";
import { JwtAuthGuard } from "./auth/rbac/auth.guard";
import type { UserRequest } from "./auth/api/dtos/user-request";
import { RolesGuard } from "./auth/rbac/roles.guard";
import { Roles } from "./auth/rbac/roles.decorator";
import { AdminService } from "./admin.service";
import { FinanceService } from "./finance.service";
import { CrmStudentsQueryDto } from "./api/dto/crm-students-query.dto";
import { UpdateCrmStudentStatusDto } from "./api/dto/update-crm-student-status.dto";
import { AdminCreateUserDto } from "./api/dto/admin-create-user.dto";
import { AdminPatchUserDto } from "./api/dto/admin-patch-user.dto";
import { FinanceContractsQueryDto } from "./api/dto/finance-contracts-query.dto";
import { ADMIN_USER_LIST_SELECT } from "./admin-user.select";

@ApiTags("Admin")
@Controller("admin")
export class AdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly adminService: AdminService,
    private readonly financeService: FinanceService,
  ) {}

  @Get("users")
  @ApiOperation({ summary: "Full user list for admin panel (ADMIN role only)" })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("ADMIN")
  async getAllUsers() {
    return this.prisma.user.findMany({
      orderBy: { id: "asc" },
      select: ADMIN_USER_LIST_SELECT,
    });
  }

  @Post("users")
  @ApiOperation({ summary: "Create user (admin)" })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("ADMIN")
  async createAdminUser(@Body() dto: AdminCreateUserDto) {
    return this.adminService.createAdminUser(dto);
  }

  @Get("roles")
  @ApiOperation({ summary: "Role list for admin UI (dropdowns)" })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("ADMIN")
  async listRolesForAdmin() {
    return this.adminService.listRoles();
  }

  @Get("users/:id")
  @ApiOperation({ summary: "User detail for admin panel" })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("ADMIN")
  async getAdminUserById(@Param("id", ParseIntPipe) id: number) {
    return this.adminService.getAdminUserById(id);
  }

  @Patch("users/:id")
  @ApiOperation({ summary: "Partial update user (admin)" })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("ADMIN")
  async patchAdminUser(@Param("id", ParseIntPipe) id: number, @Body() dto: AdminPatchUserDto, @Req() req: UserRequest) {
    return this.adminService.updateAdminUser(id, dto, req.user.id);
  }

  @Patch("users/:id/block")
  @ApiOperation({ summary: "Soft-block user (sets deletedAt)" })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("ADMIN")
  async blockUser(@Param("id", ParseIntPipe) id: number, @Req() req: UserRequest) {
    if (req.user.id === id) {
      throw new BadRequestException("Cannot block your own account");
    }
    try {
      return await this.prisma.user.update({
        where: { id },
        data: { deletedAt: new Date() },
        select: ADMIN_USER_LIST_SELECT,
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
        throw new NotFoundException(`User with id ${id} not found`);
      }
      throw e;
    }
  }

  @Patch("users/:id/unblock")
  @ApiOperation({ summary: "Restore user (clears deletedAt)" })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("ADMIN")
  async unblockUser(@Param("id", ParseIntPipe) id: number) {
    try {
      return await this.prisma.user.update({
        where: { id },
        data: { deletedAt: null },
        select: ADMIN_USER_LIST_SELECT,
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
        throw new NotFoundException(`User with id ${id} not found`);
      }
      throw e;
    }
  }

  @Get("dashboard")
  @ApiOperation({
    summary: "Admin home: CRM + finance + user counts + recent signups",
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("ADMIN")
  async getAdminDashboard() {
    return this.adminService.getDashboardOverview();
  }

  @Get("crm/stats")
  @ApiOperation({ summary: "CRM: student funnel stats and filter metadata" })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("ADMIN")
  async getCrmStats() {
    return this.adminService.getCrmStats();
  }

  @Get("crm/students")
  @ApiOperation({ summary: "CRM: paginated students with portrait and status" })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("ADMIN")
  async listCrmStudents(@Query() query: CrmStudentsQueryDto) {
    return this.adminService.listCrmStudents(query);
  }

  @Get("crm/students/:id")
  @ApiOperation({ summary: "CRM: student detail for admin" })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("ADMIN")
  async getCrmStudent(@Param("id", ParseIntPipe) id: number) {
    return this.adminService.getCrmStudentById(id);
  }

  @Patch("crm/students/:id/status")
  @ApiOperation({ summary: "CRM: update student pipeline step (ProcessStep via CRM label)" })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("ADMIN")
  async updateCrmStudentStatus(@Param("id", ParseIntPipe) id: number, @Body() dto: UpdateCrmStudentStatusDto) {
    return this.adminService.updateCrmStudentStatus(id, dto);
  }

  @Get("finance/contracts")
  @ApiOperation({ summary: "Finance: paginated contracts with filters" })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("ADMIN")
  async listFinanceContracts(@Query() query: FinanceContractsQueryDto) {
    return this.financeService.listContracts(query);
  }

  @Get("finance/summary")
  @ApiOperation({ summary: "Finance: totals, per-status counts, expert earnings" })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("ADMIN")
  async getFinanceSummary() {
    return this.financeService.getSummary();
  }

  @Get("finance/experts/:id/earnings")
  @ApiOperation({ summary: "Finance: contracts and totals for one expert" })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("ADMIN")
  async getExpertFinanceEarnings(@Param("id", ParseIntPipe) id: number) {
    return this.financeService.getExpertEarnings(id);
  }
}
