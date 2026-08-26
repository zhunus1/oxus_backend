import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class TargetProgramEntity {
  @ApiProperty() id: number;
  @ApiProperty() programTitle: string;
  @ApiProperty() organisationId: number;
  @ApiPropertyOptional() deadline: Date | null;
  @ApiProperty() intake: string;
  @ApiProperty() applicationStatus: string;
  @ApiPropertyOptional() statusChangedAt: Date | null;
  @ApiProperty() studentPortraitId: number;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;

  organisation?: any;
  documents?: any[];

  constructor(partial: Partial<TargetProgramEntity>) {
    Object.assign(this, partial);
  }
}
