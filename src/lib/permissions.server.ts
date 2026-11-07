import "server-only";
import { prisma } from "@/lib/prisma";
import {
  defaultPermissionsFor,
  type PermissionCode,
} from "@/lib/rbac";
import type { UserRole } from "@/generated/prisma/enums";

/**
 * Effective permissions = role defaults ∪ user grants ∖ user revocations.
 * Falls back to the static matrix if the permission tables have not been seeded.
 */
export async function resolvePermissions(
  userId: string,
  role: UserRole,
): Promise<PermissionCode[]> {
  const effective = new Set<PermissionCode>();

  const rolePermissions = await prisma.rolePermission.findMany({
    where: { role },
    select: { permission: { select: { code: true } } },
  });

  if (rolePermissions.length > 0) {
    for (const rp of rolePermissions) {
      effective.add(rp.permission.code as PermissionCode);
    }
  } else {
    for (const code of defaultPermissionsFor(role)) effective.add(code);
  }

  const overrides = await prisma.userPermission.findMany({
    where: { userId },
    select: { granted: true, permission: { select: { code: true } } },
  });

  for (const override of overrides) {
    const code = override.permission.code as PermissionCode;
    if (override.granted) effective.add(code);
    else effective.delete(code);
  }

  return [...effective];
}
