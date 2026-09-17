import { Prisma } from "generated/prisma/client";

/** Единый селект для списка и блока пользователя (без пароля). */
export const ADMIN_USER_LIST_SELECT = {
  id: true,
  firstname: true,
  lastname: true,
  middlename: true,
  email: true,
  phoneNumber: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
  role: { select: { id: true, code: true, name: true } },
  portrait: {
    select: {
      id: true,
      educationLevel: true,
      gpa: true,
      overallProgress: true,
    },
  },
} satisfies Prisma.UserSelect;

export const ADMIN_USER_DETAIL_SELECT = {
  ...ADMIN_USER_LIST_SELECT,
  countryId: true,
  citizenshipCountryId: true,
  organisationId: true,
  timezone: true,
  hasAcceptedTerms: true,
  termsAcceptedAt: true,
} satisfies Prisma.UserSelect;
