import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Prisma } from "generated/prisma/client";
import { DegreeLevel } from "generated/prisma/enums";
import { ProgramRequirementEntity } from "src/modules/program-requirement/api/dto/program-requirement.entity";

type ProgramOrganisationInclude = {
  organisation: { include: { country: true } };
};

type ProgramWithOrganisation = Prisma.ProgramGetPayload<{
  include: ProgramOrganisationInclude;
}>;

type ProgramWithDetails = Prisma.ProgramGetPayload<{
  include: ProgramOrganisationInclude & { requirements: true };
}>;

export class ProgramEntity {
  @ApiProperty()
  id: number;

  @ApiProperty()
  organisationId: number;

  @ApiPropertyOptional()
  organisationNameEn: string | null;

  @ApiPropertyOptional()
  organisationNameRu: string | null;

  @ApiPropertyOptional()
  organisationNameKk: string | null;

  @ApiPropertyOptional({ description: "ISO 3166-1 alpha-2 country code of the organisation" })
  countryIsoCode: string | null;

  @ApiPropertyOptional()
  countryNameEn: string | null;

  @ApiPropertyOptional()
  countryNameRu: string | null;

  @ApiPropertyOptional()
  countryNameKk: string | null;

  @ApiProperty()
  name: string;

  @ApiProperty({ enum: DegreeLevel })
  degreeLevel: DegreeLevel;

  @ApiPropertyOptional()
  tuitionFee: number | null;

  @ApiPropertyOptional()
  minGPA: number | null;

  @ApiPropertyOptional()
  minIELTS: number | null;

  @ApiPropertyOptional()
  applicationDeadline: Date | null;

  @ApiPropertyOptional()
  baseAcceptanceRate: number | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  constructor({ organisation, ...rest }: ProgramWithOrganisation) {
    Object.assign(this, rest);
    this.organisationNameEn = organisation.nameEn;
    this.organisationNameRu = organisation.nameRu;
    this.organisationNameKk = organisation.nameKk;
    this.countryIsoCode = organisation.country?.isoCode ?? null;
    this.countryNameEn = organisation.country?.nameEn ?? null;
    this.countryNameRu = organisation.country?.nameRu ?? null;
    this.countryNameKk = organisation.country?.nameKk ?? null;
  }
}

export class ProgramDetailEntity extends ProgramEntity {
  @ApiProperty({ type: [ProgramRequirementEntity] })
  requirements: ProgramRequirementEntity[];

  constructor({ requirements, ...rest }: ProgramWithDetails) {
    super(rest);
    this.requirements = requirements.map(r => Object.assign(new ProgramRequirementEntity(), r));
  }
}
