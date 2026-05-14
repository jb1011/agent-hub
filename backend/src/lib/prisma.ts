import "dotenv/config";

import { PrismaClient } from "@prisma/client";

if (!process.env.DATABASE_URL?.trim()) {
  console.error(
    "Missing DATABASE_URL. Copy .env.example to .env and set DATABASE_URL to your PostgreSQL connection string, then restart."
  );
  process.exit(1);
}

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
