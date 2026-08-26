import { Controller, Post, Param, Patch, Get, Body } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { AttemptService } from "../service/attempt.service";
import { AttemptEntity } from "./dto/attempt.entity";
import { CreateAttemptDto } from "./dto/create-attempt.dto";
import { UpdateAttemptDto } from "./dto/update-attempt.dto";

@ApiTags("Attempts")
@Controller("tests/:testId/attempt")
export class AttemptController {
  constructor(private readonly service: AttemptService) {}

  @ApiOperation({ summary: "Create attempt" })
  @Post()
  async create(@Param("testId") testId: number, @Body() dto: CreateAttemptDto): Promise<AttemptEntity> {
    return this.service.create(testId, dto);
  }

  @ApiOperation({ summary: "Find all attempts" })
  @Get()
  async findAll(@Param("testId") testId: number): Promise<AttemptEntity[]> {
    return this.service.findAll(testId);
  }

  @ApiOperation({ summary: "Find attempt by id" })
  @Get(":id")
  async findById(@Param("id") id: string): Promise<AttemptEntity> {
    return this.service.findById(id);
  }

  @ApiOperation({ summary: "Update attempt by id" })
  @Patch(":id")
  async updateById(@Param("id") id: string, @Body() dto: UpdateAttemptDto): Promise<AttemptEntity> {
    return this.service.updateById(id, dto);
  }

  @ApiOperation({ summary: "Submit attempt" })
  @Post(":id/submit")
  async submit(@Param("id") id: string): Promise<{ accessToken: string }> {
    return this.service.submit(id);
  }
}
