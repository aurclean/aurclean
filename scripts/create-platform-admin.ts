/**
 * Secure platform setup: creates a Platform Super Admin and prints their
 * access code ONCE (only its hash is stored).
 *
 *   npm run platform:create-admin -- "Full Name" admin@example.com [phone]
 *
 * Requires DATABASE_URL and the same AUTH_SECRET / ACCESS_CODE_PEPPER the
 * application runs with (the code is hashed with that pepper).
 */
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client";
import { generateUniqueAccessCode, accessCodeData } from "../src/lib/access-code";

const [name, email, phone] = process.argv.slice(2);
if (!name || !email) {
  console.error('Usage: npm run platform:create-admin -- "Full Name" admin@example.com [phone]');
  process.exit(1);
}
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function main() {
  if (await prisma.user.findUnique({ where: { email: email.toLowerCase() } })) {
    throw new Error(`A user with ${email} already exists`);
  }
  const { code, hash } = await generateUniqueAccessCode(prisma as never);
  const count = await prisma.user.count();
  const user = await prisma.user.create({
    data: {
      name,
      email: email.toLowerCase(),
      phone: phone ?? null,
      role: "PLATFORM_SUPER_ADMIN",
      firmId: null,
      employeeCode: `PLT${String(count + 1).padStart(4, "0")}`,
      ...accessCodeData(hash),
    },
    select: { id: true, employeeCode: true },
  });
  console.log(`Platform Super Admin created (${user.employeeCode}).`);
  console.log(`Access code (shown once, store it securely): ${code}`);
}

main().finally(() => prisma.$disconnect());
