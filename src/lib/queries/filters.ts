import "server-only";
import { prisma } from "@/lib/prisma";
import { resolveDateRange, type DateRangePreset } from "@/lib/dates";
import { isGlobalRole } from "@/lib/rbac";
import { requireFirmId, type SessionUser } from "@/lib/session";

export type SearchParams = Record<string, string | string[] | undefined>;

export function param(params: SearchParams, key: string): string | undefined {
  const value = params[key];
  if (Array.isArray(value)) return value[0];
  return value && value !== "" ? value : undefined;
}

export function pageParam(params: SearchParams, key = "page"): number {
  const parsed = Number.parseInt(param(params, key) ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

/** Branch picker options — global roles see all, everyone else sees their own. */
export async function branchOptions(user: SessionUser) {
  if (isGlobalRole(user.role)) {
    const branches = await prisma.branch.findMany({
      where: { firmId: requireFirmId(user), isActive: true },
      orderBy: [{ type: "asc" }, { name: "asc" }],
      select: { id: true, name: true, code: true },
    });
    return branches.map((branch) => ({
      value: branch.id,
      label: `${branch.name} (${branch.code})`,
    }));
  }

  if (!user.branchId) return [];
  return [
    {
      value: user.branchId,
      label: `${user.branchName ?? "My branch"}${user.branchCode ? ` (${user.branchCode})` : ""}`,
    },
  ];
}

/**
 * Resolves the branch a listing should be scoped to. Non-global roles are
 * always pinned to their own branch regardless of the query string.
 */
export function scopedBranchId(
  user: SessionUser,
  params: SearchParams,
): string | undefined {
  if (!isGlobalRole(user.role)) {
    return user.branchId ?? "__none__";
  }
  const requested = param(params, "branch");
  return requested && requested !== "all" ? requested : undefined;
}

export function dateRangeFrom(params: SearchParams) {
  return resolveDateRange(
    param(params, "range") as DateRangePreset | undefined,
    param(params, "from"),
    param(params, "to"),
  );
}

export const PAGE_SIZE = 25;

export function enumOptions<T extends string>(
  values: readonly T[],
  labels?: Partial<Record<T, string>>,
) {
  return values.map((value) => ({
    value,
    label:
      labels?.[value] ??
      value
        .toLowerCase()
        .split("_")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" "),
  }));
}
