import { Controller, Get, Param, ParseIntPipe } from "@nestjs/common";
import { LanguageService } from "../service/language.service";
import { LanguageEntity } from "./dto/language.entity";
import { ApiTags, ApiOperation, ApiResponse } from "@nestjs/swagger";

@ApiTags("Languages")
@Controller("languages")
export class LanguageController {
  constructor(private readonly service: LanguageService) {}

  @ApiOperation({ summary: "Get all languages" })
  @ApiResponse({ status: 200, description: "List of all languages" })
  @Get()
  async findAll(): Promise<LanguageEntity[]> {
    return this.service.findAll();
  }

  @ApiOperation({ summary: "Find language by ID" })
  @ApiResponse({ status: 200, description: "Language found" })
  @ApiResponse({ status: 404, description: "Language not found" })
  @Get(":id")
  async findOneById(@Param("id", ParseIntPipe) id: number): Promise<LanguageEntity> {
    return this.service.findOneById(id);
  }
}
