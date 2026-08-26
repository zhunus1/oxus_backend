import { Controller, Get, Param, ParseIntPipe } from "@nestjs/common";
import { CountryService } from "../service/country.service";
import { CountryEntity } from "./dto/country.entity";
import { ApiTags, ApiOperation, ApiResponse } from "@nestjs/swagger";

@ApiTags("Countries")
@Controller("countries")
export class CountryController {
  constructor(private readonly service: CountryService) {}

  @ApiOperation({ summary: "Get all countries" })
  @ApiResponse({ status: 200, description: "List of all countries" })
  @Get()
  async findAll(): Promise<CountryEntity[]> {
    return this.service.findAll();
  }

  @ApiOperation({ summary: "Find country by ID" })
  @ApiResponse({ status: 200, description: "Country found" })
  @ApiResponse({ status: 404, description: "Country not found" })
  @Get(":id")
  async findOneById(@Param("id", ParseIntPipe) id: number): Promise<CountryEntity> {
    return this.service.findOneById(id);
  }
}
