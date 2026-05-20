import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { logger } from "./logger";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

const createPrismaClient = () => {
  const connectionString = process.env.DATABASE_URL || "file:./prisma/dev.db";
  const adapter = new PrismaBetterSqlite3({ url: connectionString });
  const client = new PrismaClient({ adapter, log: ["error", "warn"] });

  // PRAGMAs para concorrência em SQLite. WAL permite leitores paralelos
  // enquanto há escrita; busy_timeout faz o driver esperar por lock até 5s
  // em vez de falhar imediatamente. Best-effort no boot.
  void client
    .$executeRawUnsafe("PRAGMA journal_mode = WAL")
    .then(() => client.$executeRawUnsafe("PRAGMA busy_timeout = 5000"))
    .then(() => logger.info("SQLite PRAGMAs aplicados (WAL + busy_timeout=5s)"))
    .catch((err) =>
      logger.warn({ err: (err as Error).message }, "Falha ao aplicar PRAGMAs SQLite"),
    );

  return client;
};

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
