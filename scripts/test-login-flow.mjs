import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const connectionString = process.env.DATABASE_URL;
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function resolvePermissions(userId, role) {
  const effective = new Set();

  const rolePermissions = await prisma.rolePermission.findMany({
    where: { role },
    select: { permission: { select: { code: true } } },
  });

  if (rolePermissions.length > 0) {
    for (const rp of rolePermissions) {
      effective.add(rp.permission.code);
    }
  }

  const overrides = await prisma.userPermission.findMany({
    where: { userId },
    select: { granted: true, permission: { select: { code: true } } },
  });

  for (const override of overrides) {
    const code = override.permission.code;
    if (override.granted) effective.add(code);
    else effective.delete(code);
  }

  return [...effective];
}

async function testUser(accessCode) {
  console.log(`\n========================================`);
  console.log(`Testing access code: "${accessCode}"`);
  try {
    const user = await prisma.user.findUnique({
      where: { accessCode },
      include: { branch: { select: { id: true, name: true, code: true } } },
    });

    console.log("1. User lookup:", user ? { id: user.id, name: user.name, role: user.role, status: user.status, branch: user.branch } : null);

    if (!user || user.status !== "ACTIVE") {
      console.log("-> FAILED: User not found or inactive");
      return;
    }

    console.log("2. Resolving permissions...");
    const permissions = await resolvePermissions(user.id, user.role);
    console.log("Permissions resolved count:", permissions.length);

    console.log("3. Updating lastLoginAt...");
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });
    console.log("lastLoginAt updated successfully.");

    const tokenUser = {
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
      role: user.role,
      branchId: user.branchId,
      branchName: user.branch?.name ?? null,
      branchCode: user.branch?.code ?? null,
      employeeCode: user.employeeCode,
      permissions,
    };

    console.log("-> SUCCESS! Authorize return object:", tokenUser);
  } catch (err) {
    console.error("-> ERROR during authorize:", err);
  }
}

async function main() {
  await testUser("100001");
  await testUser("900001");
  await testUser("200001");
  await testUser("300001");
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Main error:", err);
  process.exit(1);
});
