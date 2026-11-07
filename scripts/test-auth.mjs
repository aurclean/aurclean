import { prisma } from "../src/lib/prisma.js";
import { resolvePermissions } from "../src/lib/permissions.server.js";

async function testUser(accessCode) {
  console.log(`\nTesting access code: "${accessCode}"`);
  try {
    const user = await prisma.user.findUnique({
      where: { accessCode },
      include: { branch: { select: { id: true, name: true, code: true } } },
    });

    console.log("User found:", user ? { id: user.id, name: user.name, role: user.role, status: user.status } : null);

    if (!user || user.status !== "ACTIVE") {
      console.log("-> authorize would return null (User not found or inactive)");
      return;
    }

    console.log("Resolving permissions...");
    const permissions = await resolvePermissions(user.id, user.role);
    console.log("Permissions count:", permissions.length);

    console.log("Updating lastLoginAt...");
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const result = {
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

    console.log("-> authorize success:", result);
  } catch (err) {
    console.error("-> authorize THREW ERROR:", err);
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
