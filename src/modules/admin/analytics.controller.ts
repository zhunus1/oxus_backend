import { Controller, Get, Param, ParseIntPipe, Query, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "./auth/rbac/auth.guard";
import { RolesGuard } from "./auth/rbac/roles.guard";
import { Roles } from "./auth/rbac/roles.decorator";
import { AnalyticsService } from "./analytics.service";
import { AnalyticsEventsQueryDto, AnalyticsFunnelQueryDto } from "./api/dto/analytics-query.dto";

@ApiTags("Admin — Analytics")
@Controller("admin/analytics")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("ADMIN")
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get("funnel")
  @ApiOperation({ summary: "Воронка по текущему ProcessStep портретов студентов" })
  async funnel(@Query() query: AnalyticsFunnelQueryDto) {
    return this.analyticsService.getFunnel(query);
  }

  @Get("events")
  @ApiOperation({ summary: "События пути студентов (пагинация)" })
  async events(@Query() query: AnalyticsEventsQueryDto) {
    return this.analyticsService.listEvents(query);
  }

  @Get("summary")
  @ApiOperation({ summary: "Сводная аналитика за период / фильтры" })
  async summary(@Query() query: AnalyticsFunnelQueryDto) {
    return this.analyticsService.getSummary(query);
  }

  @Get("student/:id/journey")
  @ApiOperation({ summary: "Полный путь студента" })
  async studentJourney(@Param("id", ParseIntPipe) id: number) {
    return this.analyticsService.getStudentJourney(id);
  }

  @Get("countries")
  @ApiOperation({ summary: "Страны для фильтров аналитики" })
  async countries() {
    return this.analyticsService.listCountriesForFilters();
  }
}
