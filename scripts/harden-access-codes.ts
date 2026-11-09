/**
 * Bulk-converts any remaining plaintext access codes to hashes (the app also
 * does this lazily at each user's next sign-in), then nulls the plaintext.
 *
 *   npm run db:harden-access-codes
 *
 * Safe to re-run. Existing codes keep working; nothing is regenerated.
 */
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client";
import { hashAccessCode } from "../src/lib/access-code";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function main() {
  const legacy = await prisma.user.findMany({
    where: { accessCode: { not: null }, accessCodeHash: null },
    select: { id: true, accessCode: true },
  });
  for (const user of legacy) {
    await prisma.user.update({
      where: { id: user.id },
      data: { accessCodeHash: hashAccessCode(user.accessCode!), accessCode: null, accessCodeIssuedAt: new Date() },
    });
  }
  const remaining = await prisma.user.count({ where: { accessCode: { not: null } } });
  console.log(`Hashed ${legacy.length} legacy access code(s); ${remaining} plaintext code(s) remain.`);
}

main().finally(() => prisma.$disconnect());
