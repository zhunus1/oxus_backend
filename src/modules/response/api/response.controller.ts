import { Controller, Post, Get, Patch, Param, Body, ParseIntPipe } from "@nestjs/common";
import { ApiTags, ApiOperation } from "@nestjs/swagger";
import { ResponseService } from "../service/response.service";
import { CreateResponseDto } from "./dto/create-response.dto";
import { UpdateResponseDto } from "./dto/update-response.dto";
import { ResponseEntity } from "./dto/response.entity";

@ApiTags("Responses")
@Controller()
export class ResponseController {
  constructor(private readonly service: ResponseService) {}

  @ApiOperation({ summary: "Create response for an attempt" })
  @Post("attempts/:attemptId/responses")
  async create(@Param("attemptId") attemptId: string, @Body() dto: CreateResponseDto): Promise<ResponseEntity> {
    return this.service.create(attemptId, dto);
  }

  @ApiOperation({ summary: "Get attempt responses" })
  @Get("attempts/:attemptId/responses")
  async findAllByAttemptId(@Param("attemptId") attemptId: string): Promise<ResponseEntity[]> {
    return this.service.findAllByAttemptId(attemptId);
  }

  @ApiOperation({ summary: "Update response by id" })
  @Patch("attempts/:attemptId/responses/:id")
  async updateById(@Param("attemptId") attemptId: string, @Param("id", ParseIntPipe) id: number, @Body() dto: UpdateResponseDto): Promise<ResponseEntity> {
    return this.service.updateById(attemptId, id, dto);
  }
}
