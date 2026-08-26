import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query } from "@nestjs/common";
import { PromocodeService } from "../service/promocode.service";
import { CreatePromocodeDto } from "./dto/create-promocode.dto";
import { UpdatePromocodeDto } from "./dto/update-promocode.dto";
import { QueryPromocodeDto } from "./dto/query-promocode.dto";
import { ApiTags } from "@nestjs/swagger";

@ApiTags("Promocode")
@Controller("promocode")
export class PromocodeController {
  constructor(private readonly promocodeService: PromocodeService) {}

  @Post()
  async create(@Body() createPromocodeDto: CreatePromocodeDto) {
    return this.promocodeService.create(createPromocodeDto);
  }

  @Patch("id/:id")
  async updateById(@Param("id", ParseIntPipe) id: number, @Body() updatePromocodeDto: UpdatePromocodeDto) {
    return this.promocodeService.updateById(id, updatePromocodeDto);
  }

  @Get()
  async findAll(@Query() queryPromocodeDto: QueryPromocodeDto) {
    return this.promocodeService.findAll(queryPromocodeDto);
  }

  @Get("id/:id")
  async findById(@Param("id", ParseIntPipe) id: number) {
    return this.promocodeService.findById(id);
  }
  @Get(":code")
  async findByCode(@Param("code") code: string) {
    return this.promocodeService.findByCode(code);
  }
}
