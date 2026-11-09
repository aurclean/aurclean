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
    // A new TLS connection to a remote database costs 0.5-1.6s, so idle ones
    // are kept rather than closed after a few seconds. But the database side
    // drops connections that sit idle for roughly 2-3 minutes (measured), and a
    // query sent down a dead connection hangs until it errors — so retire ours
    // well before that. TCP keepalive stops intermediaries dropping them early.
    idleTimeoutMillis: 90 * 1000,
    keepAlive: true,
    connectionTimeoutMillis: 10000,
    // A query that hangs must fail, not leave a page loading forever. Pages
    // that hit these show their error/retry state instead of an endless spinner.
    // (client-side only: a server-side statement_timeout is sent as a startup
    // parameter, which pooled endpoints such as Neon's PgBouncer reject.)
    query_timeout: 25000,
  });

  // An idle pooled client can be reset by the server; without a listener the
  // 'error' event is unhandled and can take the whole process down.
  pool.on("error", (error) => {
    console.error("[db] idle client error (connection will be replaced):", error.message);
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

