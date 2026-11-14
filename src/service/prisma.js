import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, Prisma } from "../../generated/prisma/client.ts";

const connectionString = process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/festix?schema=public";

const adapter = new PrismaPg({ connectionString });
export const prisma = new PrismaClient({ adapter });
export { PrismaClient, Prisma };
export default prisma;
