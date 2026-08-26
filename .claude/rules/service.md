---
paths:
  - "src/**/*/service/*.service.ts  
---

# Service layer rules
General:
- All services are decorated with @Injectable()
- Define a private entity string property for use in error messages (e.g., private entity = "Student")
- Create a logger instance: private readonly logger = new Logger(ServiceName.name)
- Inject the repository and any utility services (e.g., MinioService) via constructor
- Services own all business logic — repositories are pure data access, controllers are pure HTTP layer
- Always use DTOs and Entities — same rules as repositories:
- Inputs: accept DTOs from the controller layer (CreateStudentDto, UpdateStudentDto, QueryStudentsDto)
- Outputs: return entity classes (StudentEntity) or PaginatedResponseDto<Entity>
- Never return raw Prisma objects or plain objects from service methods
- Services may create extended DTOs (e.g., CreateStudentExtendedDto) by enriching the controller DTO with computed fields before passing to the repository
 - Services call repositories - never call DB directly
 - Business logic lives here, not in controllers or repositories

Structure:
- One service class per file, named `XxxService`
- Keep services stateless — inject dependencies via constructor
- Export the class, wrap in @Injectable() decorator from NestJS

Error Handling Pattern:
Every service method must follow this try/catch pattern:
async method(): Promise<Entity> {
  try {
    // business logic
  } catch (err) {
    if (err instanceof HttpException) throw err;
    this.logger.error(messages.ERROR_KEY(this.entity), err, err?.stack);
    throw new InternalServerErrorException(messages.ERROR_KEY(this.entity));
  }
}

- Re-throw known HTTP exceptions — always check `if (err instanceof HttpException) throw err` (or specific subclasses like `NotFoundException`) before logging
- Log then wrap unknown errors — use `this.logger.error()` with the message, error object, and stack trace, then throw `InternalServerErrorException`
- Use centralized message constants — import from `src/configs/messages`, use factory functions like `messages.NOT_FOUND_BY_ID(this.entity, id)`, `messages.DATABASE_CREATE_ERROR(this.entity)`
- Never swallow errors silently — every catch block must either re-throw or log + throw


Existence Checks
- Before `update` or `delete`, always call `this.repo.findById(id)` first
- If not found, throw `NotFoundException(messages.NOT_FOUND_BY_ID(this.entity, id))`
- For `findById`, the service is responsible for converting the repository's `null` return into a `NotFoundException`
- Repository returns `null` for not found; service throws — this separation is strict
 
Business Logic & Data Enrichment
- Private helper methods for domain logic (e.g., `extractBirthDateFromIin`) live on the service class
- Validate domain-specific rules and throw `BadRequestException` for invalid input
- Enrich the DTO with computed values before passing to the repository (spread DTO + add computed fields)
