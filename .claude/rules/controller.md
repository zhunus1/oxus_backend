---
paths:
  - "src/**/*/api/*.controller.ts  
---

General
- Controllers are thin — they only handle HTTP concerns (decorators, parsing, validation pipes) and delegate everything to the service
- No business logic, no try/catch, no direct repository access in controllers
- Inject only the service via constructor: constructor(private service: ServiceName) {}
- Decorate the class with @Controller("resource") and @UseGuards(JwtAuthGuard) and @ApiTags("Resource")

Swagger / OpenAPI Decorators
- Every endpoint must have the following decorators:
  * @ApiOperation({ summary: "..." }) — short description of what the endpoint does
  * @ApiResponse({ status: <code>, description: "..." }) — at least one success response
  * @ApiParam(...) — for every path parameter
  * @ApiBody({ type: Dto }) — for POST/PUT endpoints
  * @ApiConsumes("multipart/form-data") — when the endpoint accepts file uploads

Parameter Parsing
- Path IDs: always use @Param("id", ParseIntPipe) id: number
- Query parameters: use @Query() query: QueryDto with a dedicated query DTO
- Request body: use @Body() dto: CreateDto or @Body() dto: UpdateDto
- Never manually parse or transform parameters in the controller — use NestJS pipes

CRUD Method Naming & HTTP Mapping
  @Post()        → create(@Body() dto, @UploadedFile() file?)
  @Get(":id")    → findById(@Param("id", ParseIntPipe) id: number)
  @Get()         → findAll(@Query() query: QueryDto)
  @Put(":id")    → updateById(@Param("id", ParseIntPipe) id, @Body() dto, @UploadedFile() file?)
  @Delete(":id") → delete(@Param("id", ParseIntPipe) id: number)

  Controller methods directly return the service call — no intermediate variables unless needed

What Controllers Must NOT Do
- No try/catch blocks — let NestJS exception filters handle errors
- No direct database or repository access
- No business logic (hashing, file processing, data enrichment, validation beyond pipes)
- No manual HTTP status code setting — rely on NestJS defaults and exceptions from the service layer
- No importing Prisma types or entity classes — controllers only know about DTOs