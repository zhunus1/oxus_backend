import { Controller, Get, Post, Req, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "src/modules/admin/auth/rbac/auth.guard";
import type { UserRequest } from "src/modules/admin/auth/api/dtos/user-request";
import { RoadmapService } from "../service/roadmap.service";

@ApiTags("AI Roadmap")
@UseGuards(JwtAuthGuard)
@Controller("roadmap")
export class RoadmapController {
  constructor(private readonly roadmapService: RoadmapService) {}

  @ApiOperation({ summary: "Confirm data freeze before roadmap generation" })
  @ApiResponse({ status: 200, description: "Identity frozen successfully" })
  @Post("confirm-freeze")
  async confirmFreeze(@Req() req: UserRequest) {
    return this.roadmapService.confirmFreeze(req.user.id);
  }

  @ApiOperation({ summary: "Generate AI roadmap (requires AI_ROADMAP subscription)" })
  @ApiResponse({ status: 200, description: "Roadmap generated successfully" })
  @Post("generate")
  async generate(@Req() req: UserRequest) {
    return this.roadmapService.generate(req.user.id);
  }

  @ApiOperation({ summary: "Regenerate roadmap (1 free within 24h)" })
  @ApiResponse({ status: 200, description: "Roadmap regenerated successfully" })
  @Post("regenerate")
  async regenerate(@Req() req: UserRequest) {
    return this.roadmapService.regenerate(req.user.id);
  }

  @ApiOperation({ summary: "Get my generated roadmap" })
  @ApiResponse({ status: 200, description: "Roadmap fetched successfully" })
  @Get("me")
  async getMyRoadmap(@Req() req: UserRequest) {
    return this.roadmapService.getMyRoadmap(req.user.id);
  }
}
