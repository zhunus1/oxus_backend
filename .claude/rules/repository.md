---
paths:
  - "src/**/repository/*.repository.ts  
---

# Repository layer rules
Structure:
- One repository class per file, named `XxxRepository`
- Always extend XxxRepository class with BaseRepository from @src/database/prisma.repository.ts
- All repositories are decorated with @Injectable()
- Export the class

Patterns:
- Repositories just create, update, delete or return data
- Always accept data via Dto`s or primitive types
- Return entity instances (e.g., new StudentEntity(...)) from all methods, never raw Prisma objects
- Soft delete only — set deletedAt: new Date(), never use prisma.*.delete()
- Always include deletedAt: null in every where clause to exclude soft-deleted records
- Never in repository call different prisma model methods. One repository - one model

Types & Imports
- Import Prisma namespace from generated/prisma/browser for type helpers like Prisma.UserWhereInput
- DTO types: src/common/dtos/pagination.dto for PaginatedResponseDto
- Entity types: co-located in the module's api/dto/ directory
- Always use DTOs and Entities — never pass or return raw Prisma types, plain objects, or any
- Inputs: accept dedicated DTOs (CreateEntityDto, UpdateEntityDto, QueryEntityDto)
- Outputs: return entity classes (StudentEntity) or PaginatedResponseDto<Entity>
- Never type parameters as Prisma.UserCreateInput or similar generated types — wrap them in a DTO
- Each operation gets its own DTO: separate Create, Update, and Query DTOs even if fields overlap
- Prisma namespace types (e.g., Prisma.UserUpdateInput) are only used internally inside method bodies for building queries, never exposed in method signatures

Method signatures:
- async create(data: CreateEntityDto): Promise<Entity>
- async findById(id: number): Promise<Entity | null>
- async findAll(query: QueryEntityDto): Promise<PaginatedResponseDto<Entity>>
- async updateById(id: number, data: UpdateEntityDto): Promise<Entity>
- async deleteById(id: number): Promise<Entity>