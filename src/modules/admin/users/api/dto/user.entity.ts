import { Exclude } from "class-transformer";
import { User } from "generated/prisma/client";

export class UserEntity implements Partial<User> {
  id: number;
  firstname: string;
  lastname: string;
  middlename: string | null;
  email: string;
  phoneNumber: string | null;
  organisationId: number | null;
  countryId: number | null;
  citizenshipCountryId: number | null;
  roleId: number;
  hasAcceptedTerms: boolean;
  termsAcceptedAt: Date | null;
  timezone: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;

  @Exclude()
  password?: string;

  constructor(partial: Partial<UserEntity>) {
    Object.assign(this, partial);
  }
}
