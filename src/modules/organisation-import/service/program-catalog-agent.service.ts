import { Injectable, InternalServerErrorException } from "@nestjs/common";
import OpenAI from "openai";
import { jsonrepair } from "jsonrepair";
import { DegreeLevel } from "generated/prisma/enums";

type ExtractedProgram = {
  name: string;
  degreeLevel: DegreeLevel;
  tuitionFee: number | null;
  minGPA: number | null;
  minIELTS: number | null;
  baseAcceptanceRate: number | null;
  sourceUrl: string | null;
};

export type ProgramCatalogExtraction = {
  officialWebsiteUrl: string | null;
  searchQuery: string;
  consultedUrls: string[];
  programs: ExtractedProgram[];
};

@Injectable()
export class ProgramCatalogAgentService {
  private readonly model = process.env.OPENAI_PROGRAM_SYNC_MODEL || "gpt-4.1-mini";
  private readonly client = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

  async extractProgramCatalog(params: {
    organisationName: string;
    countryName?: string | null;
    existingWebsiteUrl?: string | null;
    sourceUrl?: string | null;
    searchQuery: string;
  }): Promise<ProgramCatalogExtraction> {
    if (!this.client) {
      throw new InternalServerErrorException("OPENAI_API_KEY is not configured for program catalog sync.");
    }

    const prompt = [
      "You are an academic program catalog extraction agent.",
      "Find official university sources only. Ignore ranking sites, aggregators, blogs, news, and forums.",
      "Goal: populate Program rows for one organisation.",
      "Return JSON only with this shape:",
      '{"officialWebsiteUrl": string | null, "consultedUrls": string[], "programs": [{"name": string, "degreeLevel": "BACHELOR" | "MASTER" | "PHD", "tuitionFee": number | null, "minGPA": number | null, "minIELTS": number | null, "baseAcceptanceRate": number | null, "sourceUrl": string | null}]}',
      "Rules:",
      "- Use official university websites only.",
      "- Include only actual degree programs, not short courses or events.",
      "- Program name MUST be the academic discipline only (e.g. 'Computer Science', 'Mechanical Engineering', 'Psychology').",
      "- NEVER use the degree type as the name ('Bachelor of Science', 'Master of Arts', 'Bachelor of Engineering' are all wrong).",
      "- If the same discipline is offered at multiple levels, create one entry per level with the same name.",
      "- Deduplicate semantically identical programs.",
      "- tuitionFee: annual fee in USD (integer, must be > 0). Use the program-specific fee if listed; otherwise use the university's published standard annual tuition for that level (BACHELOR/MASTER/PHD). NEVER return 0 — if the actual fee is unknown, return null.",
      "- minGPA: minimum GPA on 0.0–4.0 scale required for admission. Null if not required or not found.",
      "- minIELTS: minimum IELTS overall band score (e.g. 6.5). Null if not required or not found.",
      "- baseAcceptanceRate: decimal 0–1 (e.g. 0.15 = 15%). You MUST look up the university's overall acceptance rate and use it as a fallback for every program when no program-specific rate is published. Return null ONLY when neither a program-specific nor an overall university acceptance rate can be found anywhere.",
      "- If a value is unknown, return null.",
      "- Do not invent deadlines. Deadline is out of scope.",
      `Organisation name: ${params.organisationName}`,
      `Country: ${params.countryName ?? "unknown"}`,
      `Existing official website: ${params.existingWebsiteUrl ?? "none"}`,
      `Preferred source URL: ${params.sourceUrl ?? "none"}`,
      `Search query: ${params.searchQuery}`,
    ].join("\n");

    const response = await this.client.responses.create({
      model: this.model,
      tools: [{ type: "web_search_preview" }],
      input: prompt,
    });

    const outputText = (response as any).output_text?.trim();
    if (!outputText) {
      throw new InternalServerErrorException("The AI program catalog sync returned an empty response.");
    }

    const parsed = JSON.parse(jsonrepair(this.extractJson(outputText))) as ProgramCatalogExtraction;

    return {
      officialWebsiteUrl: parsed.officialWebsiteUrl ?? null,
      searchQuery: params.searchQuery,
      consultedUrls: Array.isArray(parsed.consultedUrls) ? parsed.consultedUrls.filter(url => typeof url === "string") : [],
      programs: Array.isArray(parsed.programs)
        ? parsed.programs
            .filter(program => program && typeof program.name === "string" && Object.values(DegreeLevel).includes(program.degreeLevel))
            .map(program => ({
              name: program.name.trim(),
              degreeLevel: program.degreeLevel,
              tuitionFee: typeof program.tuitionFee === "number" && program.tuitionFee > 0 ? program.tuitionFee : null,
              minGPA: typeof program.minGPA === "number" ? program.minGPA : null,
              minIELTS: typeof program.minIELTS === "number" ? program.minIELTS : null,
              baseAcceptanceRate: typeof program.baseAcceptanceRate === "number" ? program.baseAcceptanceRate : null,
              sourceUrl: typeof program.sourceUrl === "string" ? program.sourceUrl : null,
            }))
        : [],
    };
  }

  private extractJson(text: string) {
    const fenced = text.match(/```json\s*([\s\S]*?)```/i);
    if (fenced?.[1]) return fenced[1].trim();

    const firstBrace = text.indexOf("{");
    const lastBrace = text.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return text.slice(firstBrace, lastBrace + 1);
    }

    return text;
  }
}
