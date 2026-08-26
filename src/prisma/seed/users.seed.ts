import * as bcrypt from "bcrypt";
import { prismaClient } from "./prisma-client";

export async function seedUsers() {
  const passwordHash = await bcrypt.hash("admin123", 10);

  await prismaClient.user.createMany({
    data: [
      {
        firstname: "Admin",
        lastname: "User",
        email: "admin@oxusedu.com",
        phoneNumber: "+77010000001",
        password: passwordHash,
        roleId: 1, // ADMIN
      },
      {
        firstname: "Expert",
        lastname: "Consultant",
        email: "expert@oxusedu.com",
        phoneNumber: "+77010000002",
        password: passwordHash,
        roleId: 2, // CONSULTANT
      },
      {
        firstname: "University",
        lastname: "Student",
        email: "student@oxusedu.com",
        phoneNumber: "+77010000003",
        password: passwordHash,
        roleId: 3, // STUDENT
      },
      {
        firstname: "Highschool",
        lastname: "Schoolboy",
        email: "schoolboy@oxusedu.com",
        phoneNumber: "+77010000004",
        password: passwordHash,
        roleId: 4, // SCHOOLBOY
      },
    ],
    skipDuplicates: true,
  });
}
