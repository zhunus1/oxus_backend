import { Injectable } from "@nestjs/common";
import { RecommendationRepository } from "../repository/recommendation.repository";
import { RecommendationProgramDto } from "../api/dto/recommendation-program.dto";
import { Program } from "generated/prisma/client";

type RecommendationItem = {
  universityId: number;
  programId: number;
  chance: number;
};

type RecommendationResponse = {
  programs: RecommendationItem[];
  overallChance: number;
};

@Injectable()
export class RecommendationService {
  constructor(private readonly recommendationRepository: RecommendationRepository) {}

  async recommend(dto: RecommendationProgramDto): Promise<RecommendationResponse> {
    const programs = await this.recommendationRepository.findPrograms(dto);

    const scored: RecommendationItem[] = programs.map(p => ({
      universityId: p.organisationId,
      programId: p.id,
      chance: this.estimateChance(dto, p),
    }));

    const overallChance = scored.length === 0 ? 0 : Math.round((scored.reduce((sum, x) => sum + x.chance, 0) / scored.length) * 10) / 10;

    return { programs: scored, overallChance };
  }

  private estimateChance(dto: RecommendationProgramDto, program: Program): number {
    // Base chance from DB (assume 0..100). If null/undefined -> default.
    let chance = program.baseAcceptanceRate ?? 50;

    // GPA adjustment (Program.minGPA assumed on 4.0 scale)
    if (dto.gpa !== undefined && dto.gpaScale !== undefined && dto.gpaScale > 0 && program.minGPA != null) {
      const gpaOn4 = (dto.gpa / dto.gpaScale) * 4.0;
      const diff = gpaOn4 - program.minGPA; // + means student above requirement
      chance += diff * 10; // 0.1 GPA over -> +1, 0.5 -> +5, etc.
    }

    // IELTS adjustment
    if (dto.ielts !== undefined) {
      if (program.minIELTS == null) {
        chance += 2;
      } else {
        const diff = dto.ielts - program.minIELTS;
        chance += diff * 5; // 0.5 over -> +2.5
      }
    }

    // Budget adjustment
    if (dto.maxTuitionFee !== undefined) {
      if (program.tuitionFee == null) chance += 0;
      else if (program.tuitionFee > dto.maxTuitionFee) chance -= 30;
      else chance += 2;
    }

    // Clamp 0..100
    if (chance < 0) chance = 0;
    if (chance > 100) chance = 100;

    // Keep 1 decimal for stable UI
    return Math.round(chance * 10) / 10;
  }
}
