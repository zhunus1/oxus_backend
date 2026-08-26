import { Injectable, InternalServerErrorException } from "@nestjs/common";
import OpenAI from "openai";
import { jsonrepair } from "jsonrepair";

export type ExtractedProgram = {
  name: string;
  degreeLevel: "BACHELOR" | "MASTER" | "PHD";
  tuitionFee?: number | null;
  minGPA?: number | null;
  minIELTS?: number | null;
};

export type OrganisationSuggestion = {
  nameEn: string;
  nameRu: string | null;
  nameKk: string | null;
  websiteUrl: string | null;
  type: string;
  countryIsoCode: string | null;
  slug: string;
  programs: ExtractedProgram[];
};

@Injectable()
export class OrganisationCatalogAgentService {
  private readonly model = process.env.OPENAI_PROGRAM_SYNC_MODEL || "gpt-4.1-mini";
  private readonly client = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

  async suggestOrganisations(params: { searchQuery: string; sourceUrl?: string | null }): Promise<OrganisationSuggestion[]> {
    if (!this.client) {
      throw new InternalServerErrorException("OPENAI_API_KEY is not configured.");
    }

    const prompt = [
      "You are an academic organisation data extraction agent.",
      "Find real universities, colleges, schools, or other educational/corporate organisations based on the search query.",
      "Return a JSON array (no markdown) of organisations, each with this exact shape:",
      '[{"nameEn":string,"nameRu":string|null,"nameKk":string|null,"websiteUrl":string|null,"type":"UNIVERSITY"|"COLLEGE"|"SCHOOL"|"LYCEUM"|"COMPANY"|"OTHER","countryIsoCode":string|null,"slug":string,"programs":[{"name":string,"degreeLevel":"BACHELOR"|"MASTER"|"PHD","tuitionFee":number|null,"minGPA":number|null,"minIELTS":number|null}]}]',
      "Rules:",
      "- slug: lowercase, hyphen-separated ASCII (e.g. 'university-of-cambridge')",
      "- nameRu: Russian name if well-known, otherwise null",
      "- nameKk: Kazakh name if well-known, otherwise null",
      "- countryIsoCode: 2-letter ISO 3166-1 alpha-2 (e.g. 'GB', 'US', 'KZ'), or null if unknown",
      "- Return up to 20 results, deduplicated by nameEn",
      "- Only real, verifiable organisations",
      "- programs: include up to 8 real programs offered by each organisation",
      "- programs.name: academic discipline ONLY (e.g. 'Computer Science', 'Psychology') — NEVER the degree type ('Bachelor of Science', 'Master of Arts' are wrong)",
      "- programs.degreeLevel: BACHELOR for 4-year undergraduate, MASTER for graduate/postgraduate, PHD for doctoral",
      "- programs.tuitionFee: annual fee in USD (integer), or null if unknown",
      "- programs.minGPA: minimum GPA on 0.0–4.0 scale, or null if not required/unknown",
      "- programs.minIELTS: minimum IELTS band (e.g. 6.5), or null if not required/unknown",
      `Search query: ${params.searchQuery}`,
      `Preferred source URL: ${params.sourceUrl ?? "none"}`,
    ].join("\n");

    const response = await this.client.responses.create({
      model: this.model,
      tools: [{ type: "web_search_preview" }],
      input: prompt,
    });

    const outputText = (response as any).output_text?.trim();
    if (!outputText) {
      throw new InternalServerErrorException("AI organisation suggestion returned an empty response.");
    }

    const parsed = this.parseAiJson(outputText) as OrganisationSuggestion[];

    const DEGREE_LEVELS = new Set(["BACHELOR", "MASTER", "PHD"]);

    return Array.isArray(parsed)
      ? parsed
          .filter(s => s && typeof s.nameEn === "string" && s.nameEn.trim())
          .map(s => ({
            nameEn: s.nameEn.trim(),
            nameRu: typeof s.nameRu === "string" && s.nameRu.trim() ? s.nameRu.trim() : null,
            nameKk: typeof s.nameKk === "string" && s.nameKk.trim() ? s.nameKk.trim() : null,
            websiteUrl: typeof s.websiteUrl === "string" ? s.websiteUrl : null,
            type: typeof s.type === "string" ? s.type : "UNIVERSITY",
            countryIsoCode: typeof s.countryIsoCode === "string" ? s.countryIsoCode.toUpperCase() : null,
            slug: typeof s.slug === "string" && s.slug.trim() ? this.sanitizeSlug(s.slug) : this.toSlug(s.nameEn),
            programs: Array.isArray(s.programs)
              ? s.programs
                  .filter((p: any) => p && typeof p.name === "string" && p.name.trim() && DEGREE_LEVELS.has(p.degreeLevel))
                  .map(
                    (p: any): ExtractedProgram => ({
                      name: p.name.trim(),
                      degreeLevel: p.degreeLevel as "BACHELOR" | "MASTER" | "PHD",
                      tuitionFee: typeof p.tuitionFee === "number" && p.tuitionFee > 0 ? Math.round(p.tuitionFee) : null,
                      minGPA: typeof p.minGPA === "number" && p.minGPA > 0 ? p.minGPA : null,
                      minIELTS: typeof p.minIELTS === "number" && p.minIELTS > 0 ? p.minIELTS : null,
                    }),
                  )
              : [],
          }))
      : [];
  }

  private sanitizeSlug(slug: string): string {
    return slug
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  }

  private toSlug(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  }

  private parseAiJson(text: string): any[] {
    // Extract the JSON array portion from the response text
    const raw = this.extractJsonString(text);
    try {
      // jsonrepair handles trailing commas, missing commas, comments,
      // unescaped chars, truncated JSON, and other AI formatting issues
      const repaired = jsonrepair(raw);
      const result = JSON.parse(repaired);
      return Array.isArray(result) ? result : [];
    } catch {
      return [];
    }
  }

  private extractJsonString(text: string): string {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) return fenced[1].trim();
    const firstBracket = text.indexOf("[");
    if (firstBracket >= 0) {
      return text.slice(firstBracket);
    }
    return text;
  }
}
