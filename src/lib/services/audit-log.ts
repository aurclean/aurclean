import "server-only";

import { prisma } from "@/lib/prisma";
import { ROLE_LABELS } from "@/lib/rbac";
import type { UserRole } from "@/generated/prisma/enums";

export interface AuditLogFilters {
  firmId: string;
  branchId?: string;
  search?: string;
  action?: string;
  userId?: string;
  limit?: number;
}

export interface AuditLogRow {
  id: string;
  userName: string;
  userRole: string;
  userEmail: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  summary: string | null;
  branchName: string | null;
  ipAddress: string | null;
  createdAt: string;
}

export async function listAuditLogs(filters: AuditLogFilters): Promise<AuditLogRow[]> {
  const rows = await prisma.auditLog.findMany({
    where: {
      firmId: filters.firmId,
      ...(filters.branchId ? { branchId: filters.branchId } : {}),
      ...(filters.action ? { action: filters.action } : {}),
      ...(filters.userId ? { userId: filters.userId } : {}),
      ...(filters.search
        ? {
            OR: [
              { action: { contains: filters.search, mode: "insensitive" } },
              { entity: { contains: filters.search, mode: "insensitive" } },
              { summary: { contains: filters.search, mode: "insensitive" } },
              { user: { name: { contains: filters.search, mode: "insensitive" } } },
            ],
          }
        : {}),
    },
    include: {
      user: { select: { name: true, role: true, email: true } },
      branch: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: filters.limit ?? 100,
  });

  return rows.map((r) => ({
    id: r.id,
    userName: r.user?.name ?? "System / Guest",
    userRole: r.user?.role ? ROLE_LABELS[r.user.role as UserRole] ?? r.user.role : "System",
    userEmail: r.user?.email ?? null,
    action: r.action,
    entity: r.entity,
    entityId: r.entityId,
    summary: r.summary,
    branchName: r.branch?.name ?? null,
    ipAddress: r.ipAddress,
    createdAt: r.createdAt.toISOString(),
  }));
}
