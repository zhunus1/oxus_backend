import { EducationLevel, ProcessStep, SubscriptionTier } from "generated/prisma/enums";

export class PortraitLanguageEntity {
  id: number;
  languageId: number;
  level: string;
  createdAt: Date;

  language: {
    id: number;
    code: string;
    name: string;
  };

  constructor(partial: Partial<PortraitLanguageEntity>) {
    Object.assign(this, partial);
  }
}

export class PortraitTestEntity {
  id: number;
  testType: string;
  totalScore: number;
  reading: number | null;
  listening: number | null;
  writing: number | null;
  speaking: number | null;
  testDate: Date | null;

  constructor(partial: Partial<PortraitTestEntity>) {
    Object.assign(this, partial);
  }
}

export class PortraitCountryEntity {
  countryId: number;

  country: {
    id: number;
    isoCode: string;
    nameEn: string | null;
    nameRu: string | null;
    nameKk: string | null;
  };

  constructor(partial: Partial<PortraitCountryEntity>) {
    Object.assign(this, partial);
  }
}

export class PortraitEntity {
  id: number;
  userId: number;

  hasVisa: boolean;
  birthDate: Date | null;
  educationLevel: EducationLevel;
  major: string | null;

  gpa: number | null;
  gpaScale: number;

  budgetLimit: number | null;
  budgetCurrency: string | null;

  currentStep: ProcessStep;
  overallProgress: number;

  subscription: SubscriptionTier;
  consultationBalance: number;

  isIdentityLocked: boolean;
  generationCount: number;
  roadmapGeneratedAt: Date | null;
  consultantId: number;
  expertUserId: number | null;

  updatedAt: Date;

  languages: PortraitLanguageEntity[];
  tests: PortraitTestEntity[];
  targetCountries: PortraitCountryEntity[];

  constructor(partial: Partial<PortraitEntity>) {
    Object.assign(this, partial);
  }
}
