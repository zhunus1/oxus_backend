import { Module } from "@nestjs/common";
import { RecommendationController } from "./api/recommendation.controller";
import { RecommendationService } from "./service/recommendation.service";
import { RecommendationRepository } from "./repository/recommendation.repository";
import { PrismaModule } from "src/database/prisma.module";

@Module({
  imports: [PrismaModule],
  controllers: [RecommendationController],
  providers: [RecommendationService, RecommendationRepository],
})
export class RecommendationModule {}
