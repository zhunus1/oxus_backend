import { Controller, Get, Param, ParseIntPipe, Query, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "src/modules/admin/auth/rbac/auth.guard";
import { ExpertScheduleService } from "../service/expert-schedule.service";
import { GetAvailableSlotsDto } from "./dto/get-available-slots.dto";

@ApiTags("Expert Availability")
@UseGuards(JwtAuthGuard)
@Controller("experts")
export class ExpertAvailabilityController {
  constructor(private readonly expertScheduleService: ExpertScheduleService) {}

  @ApiOperation({ summary: "Get available slots for an expert on a specific date" })
  @ApiResponse({ status: 200, description: "Available slots fetched successfully" })
  @Get(":id/available-slots")
  async getAvailableSlots(@Param("id", ParseIntPipe) expertId: number, @Query() dto: GetAvailableSlotsDto) {
    return this.expertScheduleService.getAvailableSlots(expertId, dto);
  }
}
