import "server-only";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isGlobalRole, isPlatformRole, type PermissionCode } from "@/lib/rbac";
import type { UserRole } from "@/generated/prisma/enums";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  image?: string | null;
  role: UserRole;
  branchId: string | null;
  branchName: string | null;
  branchCode: string | null;
  employeeCode: string | null;
  permissions: PermissionCode[];
  /** The firm this user's own account belongs to. Null only for PLATFORM_ADMIN. */
  firmId: string | null;
  firmName: string | null;
  /**
   * The firm actually being operated in for this request. Equal to firmId
   * for every ordinary firm user (fixed, never switchable). For
   * PLATFORM_ADMIN this is whichever firm they last "entered" via the Firms
   * module's switcher — null until they do, in which case operational
   * pages have nothing to scope to and requireFirm() below sends them back
   * to /firms rather than ever falling through to an unscoped query.
   */
  activeFirmId: string | null;
  activeFirmName: string | null;
}

export class AuthorizationError extends Error {
  constructor(message = "You do not have permission to perform this action") {
    super(message);
    this.name = "AuthorizationError";
  }
}

export class AuthenticationError extends Error {
  constructor(message = "You must be signed in") {
    super(message);
    this.name = "AuthenticationError";
  }
}

export async function getCurrentUser(): Promise<SessionUser | null> {
  const session = await auth();
  if (!session?.user?.id) return null;

  const firmId = session.user.firmId ?? null;
  if (firmId) {
    // JWT sessions are stateless, so a firm deactivated after a user's
    // token was issued would otherwise keep working until the token next
    // refreshes. Re-verified on every request so login, API access, order
    // creation and scanning all stop immediately for a deactivated firm's
    // users, per the multi-tenant spec's deactivation requirement — without
    // ever deleting the firm's existing data.
    const firm = await prisma.firm.findUnique({ where: { id: firmId }, select: { status: true } });
    if (!firm || firm.status !== "ACTIVE") return null;
  }

  return {
    id: session.user.id,
    name: session.user.name ?? "",
    email: session.user.email ?? "",
    image: session.user.image,
    role: session.user.role,
    branchId: session.user.branchId,
    branchName: session.user.branchName,
    branchCode: session.user.branchCode,
    employeeCode: session.user.employeeCode,
    permissions: session.user.permissions ?? [],
    firmId: session.user.firmId ?? null,
    firmName: session.user.firmName ?? null,
    activeFirmId: session.user.activeFirmId ?? null,
    activeFirmName: session.user.activeFirmName ?? null,
  };
}

/** For pages: bounces to /login when there is no session. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export function hasPermission(
  user: Pick<SessionUser, "permissions">,
  permission: PermissionCode | PermissionCode[],
): boolean {
  const wanted = Array.isArray(permission) ? permission : [permission];
  return wanted.some((code) => user.permissions.includes(code));
}

export function hasAllPermissions(
  user: Pick<SessionUser, "permissions">,
  permissions: PermissionCode[],
): boolean {
  return permissions.every((code) => user.permissions.includes(code));
}

/** For pages: 403 page when the signed-in user lacks the permission. */
export async function requirePermission(
  permission: PermissionCode | PermissionCode[],
): Promise<SessionUser> {
  const user = await requireUser();
  if (!hasPermission(user, permission)) redirect("/forbidden");
  return user;
}

/** For server actions and route handlers: throws instead of redirecting. */
export async function authorize(
  permission: PermissionCode | PermissionCode[],
): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw new AuthenticationError();
  if (!hasPermission(user, permission)) throw new AuthorizationError();
  return user;
}

/**
 * The tenant boundary every operational query must filter by. Never reads
 * from a request body, query string, or client-supplied value — always the
 * server-resolved session. Throws for a PLATFORM_ADMIN who hasn't entered a
 * firm yet, rather than ever letting a caller fall back to "no filter".
 */
export function requireFirmId(user: SessionUser): string {
  if (!user.activeFirmId) {
    throw new AuthorizationError(
      isPlatformRole(user.role)
        ? "Select a firm from the Firms module before accessing operational data."
        : "Your account is not assigned to a firm.",
    );
  }
  return user.activeFirmId;
}

/** For pages: 403 page instead of throwing when no firm is active. */
export async function requirePermissionInFirm(
  permission: PermissionCode | PermissionCode[],
): Promise<SessionUser & { activeFirmId: string }> {
  const user = await requirePermission(permission);
  if (!user.activeFirmId) redirect("/firms");
  return user as SessionUser & { activeFirmId: string };
}

/**
 * Branch scoping. Global roles may query any branch within their own firm
 * (or all of them); everyone else is pinned to the branch they belong to,
 * whatever the request asks for. `firmId` is always the caller's own
 * resolved tenant — every query built from this result MUST also filter by
 * it, since `branchId: undefined` (the "all branches" case) applies no
 * branch filter at all and would otherwise return every firm's rows.
 */
export function resolveBranchScope(
  user: SessionUser,
  requestedBranchId?: string | null,
): { branchId?: string; canSeeAllBranches: boolean; firmId: string } {
  const firmId = requireFirmId(user);
  const canSeeAllBranches =
    isGlobalRole(user.role) ||
    user.permissions.includes("dashboard.view_all_branches" as PermissionCode);

  if (!canSeeAllBranches) {
    return { branchId: user.branchId ?? "__no_branch__", canSeeAllBranches: false, firmId };
  }

  if (requestedBranchId && requestedBranchId !== "all") {
    return { branchId: requestedBranchId, canSeeAllBranches: true, firmId };
  }

  return { branchId: undefined, canSeeAllBranches: true, firmId };
}

/**
 * Throws if a user tries to touch a record belonging to another branch.
 * Firm-safe by construction: a user's own branchId is only ever assigned
 * from a branch in their own firm (enforced at staff-creation time), so a
 * specific branchId can never belong to another tenant.
 */
export function assertBranchAccess(user: SessionUser, branchId: string | null) {
  if (isGlobalRole(user.role)) return;
  if (!branchId) return;
  if (user.branchId !== branchId) {
    throw new AuthorizationError("This record belongs to a different branch");
  }
}

/**
 * Throws (403-equivalent) if a fetched record's own firmId doesn't match
 * the caller's active firm. This is the direct-by-id ownership check the
 * multi-tenant spec requires: GET /api/orders/123 must verify
 * order.firmId === currentUser.firmId before returning anything, no matter
 * how the id was supplied.
 */
export function assertFirmAccess(user: SessionUser, recordFirmId: string | null | undefined) {
  const firmId = requireFirmId(user);
  if (recordFirmId !== firmId) {
    throw new AuthorizationError("This record belongs to a different organization");
  }
}

/**
 * The branch a newly created record should be filed under. For a global
 * role that requested a specific branch, the branch is verified to belong
 * to the caller's own firm before being trusted — otherwise a manipulated
 * branchId could file a record under another firm's branch while its
 * firmId (set separately via requireFirmId) is the caller's own, breaking
 * the "a branchId always belongs to its own firmId" invariant other checks
 * in this file rely on.
 */
export async function requireWriteBranch(
  user: SessionUser,
  requestedBranchId?: string | null,
): Promise<string> {
  if (isGlobalRole(user.role)) {
    const branchId = requestedBranchId ?? user.branchId;
    if (!branchId) throw new AuthorizationError("A branch must be selected");
    if (requestedBranchId) {
      const firmId = requireFirmId(user);
      const branch = await prisma.branch.findUnique({
        where: { id: branchId },
        select: { firmId: true },
      });
      if (!branch || branch.firmId !== firmId) {
        throw new AuthorizationError("That branch does not belong to your organization");
      }
    }
    return branchId;
  }
  if (!user.branchId) {
    throw new AuthorizationError("Your account is not assigned to a branch");
  }
  if (requestedBranchId && requestedBranchId !== user.branchId) {
    throw new AuthorizationError("You can only create records for your own branch");
  }
  return user.branchId;
}
