// src/modules/recommendation/api/recommendation.controller.ts
import { Body, Controller, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { RecommendationService } from "../service/recommendation.service";
import { RecommendationProgramDto } from "./dto/recommendation-program.dto";

@ApiTags("Recommendation")
@Controller("recommendation")
export class RecommendationController {
  constructor(private readonly recommendationService: RecommendationService) {}

  @Post()
  async recommend(@Body() dto: RecommendationProgramDto) {
    return this.recommendationService.recommend(dto);
  }
}
