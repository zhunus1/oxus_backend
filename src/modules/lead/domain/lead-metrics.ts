import { BadRequestException } from "@nestjs/common";

/** Accepts a complete frontend result or no result; never invents missing metrics. */
export function readFrontendLeadMetrics({ score, percent, universities }: { score?: number; percent?: number; universities?: number }) {
  if (score === undefined && percent === undefined && universities === undefined) return undefined;
  if (
    typeof score !== "number" ||
    !Number.isInteger(score) ||
    score < 0 ||
    score > 1000 ||
    typeof percent !== "number" ||
    !Number.isInteger(percent) ||
    percent < 0 ||
    percent > 100 ||
    typeof universities !== "number" ||
    !Number.isInteger(universities) ||
    universities < 0 ||
    universities > 10000
  )
    throw new BadRequestException("Provide score (0–1000), percent (0–100) and universities (0–10000) together as integers, or omit all three");
  return { score, percent, universities };
}
