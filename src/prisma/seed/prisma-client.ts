import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "generated/prisma/client";

// const adapter = new PrismaPg({ connectionString: "postgres://postgres:testing@localhost:5432/academicapply_db?schema=public" });
const connectionString = process.env.DATABASE_URL;
const adapter = new PrismaPg({ connectionString });

export const prismaClient = new PrismaClient({ adapter });
