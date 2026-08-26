export class PaginationMetaDto {
  page: number;
  limit: number;
  totalItems: number;
  totalPages: number;
}

export class PaginatedResponseDto<T> {
  data: T[];
  meta: PaginationMetaDto;
}
