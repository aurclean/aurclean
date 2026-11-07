import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

const createPrismaClient = (): PrismaClient => {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    // Deferred to first real use (see the Proxy below) rather than thrown at
    // module load, so a build step without runtime env vars doesn't fail —
    // but a genuinely missing DATABASE_URL at runtime must still fail loudly
    // instead of silently connecting to some other local database.
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env and configure your PostgreSQL connection.",
    );
  }

  const isProduction = process.env.NODE_ENV === "production";
  const needsSsl = connectionString.includes("sslmode=") || isProduction;

  const pool = new Pool({
    connectionString,
    ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
    max: isProduction ? 10 : 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });

  return new PrismaClient({
    adapter: new PrismaPg(pool as any),
    log:
      process.env.NODE_ENV === "development"
        ? ["warn", "error"]
        : ["error"],
  });
};

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function getPrismaClient(): PrismaClient {
  if (globalForPrisma.prisma) {
    return globalForPrisma.prisma;
  }
  // Cache on globalThis in every environment, not just development. This
  // module's export is a Proxy whose get() trap calls getPrismaClient() on
  // every single property access (prisma.order, prisma.garment, ...) — so
  // without this cache, production requests were constructing a brand-new
  // PrismaClient (and a brand-new pg connection pool) on every property
  // access and never closing it, exhausting Postgres's max_connections
  // within a handful of page loads. Dev keeps the same global-cache pattern
  // it always needed to survive Fast Refresh module reloads.
  const client = createPrismaClient();
  globalForPrisma.prisma = client;
  return client;
}

export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    const instance = getPrismaClient();
    const value = Reflect.get(instance, prop, receiver);
    return typeof value === "function" ? value.bind(instance) : value;
  },
});

export type { Prisma } from "@/generated/prisma/client";

