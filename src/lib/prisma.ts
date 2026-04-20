import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

const createPrismaClient = () => {
  const connectionString = process.env.DATABASE_URL || "file:./prisma/dev.db";
  const adapter = new PrismaBetterSqlite3({ url: connectionString });

  return new PrismaClient({ adapter, log: ["error", "warn"] });
};

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
