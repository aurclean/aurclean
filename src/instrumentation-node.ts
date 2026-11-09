import dns from "node:dns";

import { prisma } from "@/lib/prisma";

/**
 * Node-runtime startup work (kept out of instrumentation.ts so the edge bundle
 * never sees Node-only modules).
 *
 * 1. Prefer IPv4 when resolving hostnames. Many database hosts publish both
 *    IPv6 and IPv4 addresses; on networks where IPv6 is advertised but not
 *    actually routable, a connection that tries the IPv6 address first hangs
 *    until the connect timeout (10s here), and which address comes first varies
 *    per lookup — so sign-ins and page loads intermittently stalled or failed.
 *    Resolving IPv4 first removes the stall; hosts with working IPv6 are
 *    unaffected.
 *
 * 2. Open the first database connection immediately, so the first real request
 *    doesn't also pay for the TLS handshake. Fire-and-forget: it never delays
 *    startup and a failure is only logged.
 */
export function startup() {
  dns.setDefaultResultOrder("ipv4first");
  prisma.$queryRaw`SELECT 1`.catch((error: unknown) => {
    console.error("[startup] database warm-up failed:", error instanceof Error ? error.message : error);
  });
}
