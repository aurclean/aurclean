/**
 * Re-syncs the `permission` and `role_permission` tables with the current
 * `PERMISSIONS` / `ROLE_PERMISSIONS` matrix in src/lib/rbac.ts.
 *
 * Effective permissions are resolved from the database (see
 * resolvePermissions in src/lib/permissions.server.ts), which falls back to
 * the static matrix only when role_permission is completely empty. That
 * means adding a new permission code to rbac.ts has no effect on a database
 * that has already been seeded once, until this is run — a new code silently
 * denies access to every role, including Super Admin, rather than granting
 * it. Run this after any change to the permission matrix.
 *
 * Unlike prisma/seed.ts this touches only the permission tables — it never
 * clears orders, customers, or any other business data.
 */
import fs from "node:fs";
import path from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client";
import type { UserRole } from "../src/generated/prisma/enums";
import { PERMISSIONS, PERMISSION_DESCRIPTIONS, ROLE_PERMISSIONS } from "../src/lib/rbac";

if (!process.env.DATABASE_URL) {
  try {
    const envFile = fs.readFileSync(path.join(process.cwd(), ".env"), "utf-8");
    for (const line of envFile.split("\n")) {
      const match = line.match(/^\s*([\w_]+)\s*=\s*"?([^"\n]+)"?/);
      if (match?.[1] && match[2]) process.env[match[1]] = match[2];
    }
  } catch {
    // Ignore if .env doesn't exist
  }
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function main() {
  const codes = Object.values(PERMISSIONS);

  for (const code of codes) {
    await prisma.permission.upsert({
      where: { code },
      create: {
        code,
        module: code.split(".")[0],
        description: PERMISSION_DESCRIPTIONS[code] ?? code,
      },
      update: { description: PERMISSION_DESCRIPTIONS[code] ?? code },
    });
  }

  const permissions = await prisma.permission.findMany({ select: { id: true, code: true } });
  const idByCode = new Map(permissions.map((entry) => [entry.code, entry.id]));

  await prisma.rolePermission.deleteMany();
  const rows = Object.entries(ROLE_PERMISSIONS).flatMap(([role, granted]) =>
    granted
      .map((code) => idByCode.get(code))
      .filter((id): id is string => Boolean(id))
      .map((permissionId) => ({ role: role as UserRole, permissionId })),
  );
  await prisma.rolePermission.createMany({ data: rows, skipDuplicates: true });

  console.log(`Synced ${codes.length} permissions and ${rows.length} role grants.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
