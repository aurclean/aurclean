import Link from "next/link";
import { ArrowLeft, ScrollText } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { PageHeader } from "@/components/shared/page-header";
import { Pagination } from "@/components/shared/pagination";
import { Badge } from "@/components/ui/badge";
import { prisma } from "@/lib/prisma";
import { formatDateTime } from "@/lib/dates";
import { PERMISSIONS } from "@/lib/rbac";
import { requireFirmId, requirePermission } from "@/lib/session";
import { humanize } from "@/lib/utils";
import {
  PAGE_SIZE,
  branchOptions,
  dateRangeFrom,
  pageParam,
  param,
  scopedBranchId,
  type SearchParams,
} from "@/lib/queries/filters";
import type { Prisma } from "@/generated/prisma/client";

export const metadata = { title: "Audit log" };

interface AuditRow {
  id: string;
  createdAt: Date;
  action: string;
  entity: string;
  entityId: string | null;
  summary: string | null;
  userName: string | null;
  userRole: string | null;
  branchName: string | null;
  ipAddress: string | null;
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const user = await requirePermission(PERMISSIONS.AUDIT_VIEW);

  const page = pageParam(params);
  const branchId = scopedBranchId(user, params);
  const firmId = requireFirmId(user);
  const range = dateRangeFrom(params);
  const search = param(params, "q");
  const entity = param(params, "entity");

  const where: Prisma.AuditLogWhereInput = {
    firmId,
    ...(branchId ? { branchId } : {}),
    ...(entity && entity !== "all" ? { entity } : {}),
    ...(range ? { createdAt: { gte: range.from, lte: range.to } } : {}),
    ...(search
      ? {
          OR: [
            { action: { contains: search, mode: "insensitive" } },
            { summary: { contains: search, mode: "insensitive" } },
            { entityId: { contains: search } },
            { user: { name: { contains: search, mode: "insensitive" } } },
          ],
        }
      : {}),
  };

  const [logs, total, entities, branches] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        user: { select: { name: true, role: true } },
        branch: { select: { name: true } },
      },
    }),
    prisma.auditLog.count({ where }),
    prisma.auditLog.groupBy({ by: ["entity"], where: { firmId }, _count: { _all: true } }),
    branchOptions(user),
  ]);

  const rows: AuditRow[] = logs.map((log) => ({
    id: log.id,
    createdAt: log.createdAt,
    action: log.action,
    entity: log.entity,
    entityId: log.entityId,
    summary: log.summary,
    userName: log.user?.name ?? null,
    userRole: log.user?.role ?? null,
    branchName: log.branch?.name ?? null,
    ipAddress: log.ipAddress,
  }));

  const columns: Column<AuditRow>[] = [
    {
      key: "when",
      header: "When",
      cell: (row) => (
        <span className="whitespace-nowrap text-sm text-muted-foreground">
          {formatDateTime(row.createdAt)}
        </span>
      ),
    },
    {
      key: "who",
      header: "Who",
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate text-sm">{row.userName ?? "System"}</p>
          {row.userRole ? (
            <p className="text-xs text-muted-foreground">{humanize(row.userRole)}</p>
          ) : null}
        </div>
      ),
    },
    {
      key: "action",
      header: "Action",
      cell: (row) => (
        <div className="space-y-0.5">
          <Badge tone="neutral">{humanize(row.action)}</Badge>
          <p className="text-xs text-muted-foreground">{row.entity}</p>
        </div>
      ),
    },
    {
      key: "summary",
      header: "Detail",
      cell: (row) => (
        <p className="max-w-96 text-sm text-muted-foreground">{row.summary ?? "—"}</p>
      ),
    },
    {
      key: "branch",
      header: "Branch",
      hideOnMobile: true,
      cell: (row) => (
        <span className="text-sm text-muted-foreground">{row.branchName ?? "—"}</span>
      ),
    },
    {
      key: "ip",
      header: "IP",
      hideOnMobile: true,
      cell: (row) => (
        <span className="font-mono text-xs text-muted-foreground">
          {row.ipAddress ?? "—"}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Audit log"
        description={`${total.toLocaleString("en-IN")} recorded actions. Entries are written automatically and never edited.`}
        actions={
          <Button asChild variant="outline">
            <Link href="/settings">
              <ArrowLeft /> Settings
            </Link>
          </Button>
        }
      />

      <FilterBar
        searchPlaceholder="Action, detail, record id or user…"
        showDateRange
        filters={[
          {
            name: "entity",
            label: "Entity",
            options: entities
              .sort((a, b) => b._count._all - a._count._all)
              .map((row) => ({ value: row.entity, label: row.entity })),
          },
          ...(branches.length > 1
            ? [{ name: "branch", label: "Branch", options: branches }]
            : []),
        ]}
      />

      <DataTable
        columns={columns}
        rows={rows}
        getRowKey={(row) => row.id}
        empty={
          <EmptyState
            icon={ScrollText}
            title="No audit entries"
            description="Every create, update and delete across the system is recorded here."
          />
        }
      />

      <Pagination page={page} pageSize={PAGE_SIZE} total={total} />
    </div>
  );
}
