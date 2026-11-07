import Link from "next/link";
import { MessageSquareWarning } from "lucide-react";

import { DataTable, type Column } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { PageHeader } from "@/components/shared/page-header";
import { Pagination } from "@/components/shared/pagination";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { NewComplaintDialog } from "@/app/(app)/complaints/complaint-dialogs";
import { prisma } from "@/lib/prisma";
import { formatDate } from "@/lib/dates";
import { PERMISSIONS } from "@/lib/rbac";
import { hasPermission, requireFirmId, requirePermission } from "@/lib/session";
import { humanize } from "@/lib/utils";
import {
  PAGE_SIZE,
  branchOptions,
  enumOptions,
  pageParam,
  param,
  scopedBranchId,
  type SearchParams,
} from "@/lib/queries/filters";
import type { Prisma } from "@/generated/prisma/client";

export const metadata = { title: "Complaints" };

interface ComplaintRow {
  id: string;
  complaintNumber: string;
  type: string;
  status: string;
  priority: string;
  raisedByName: string;
  orderId: string | null;
  orderNumber: string | null;
  garmentCode: string | null;
  assignedTo: string | null;
  createdAt: Date;
}

export default async function ComplaintsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const user = await requirePermission(PERMISSIONS.COMPLAINT_VIEW);

  const page = pageParam(params);
  const branchId = scopedBranchId(user, params);
  const firmId = requireFirmId(user);
  const search = param(params, "q");
  const status = param(params, "status");
  const type = param(params, "type");
  const priority = param(params, "priority");

  const where: Prisma.ComplaintWhereInput = {
    firmId,
    ...(branchId ? { branchId } : {}),
    ...(status && status !== "all" ? { status: status as never } : {}),
    ...(type && type !== "all" ? { type: type as never } : {}),
    ...(priority && priority !== "all" ? { priority: priority as never } : {}),
    ...(search
      ? {
          OR: [
            { complaintNumber: { contains: search, mode: "insensitive" } },
            { raisedByName: { contains: search, mode: "insensitive" } },
            { description: { contains: search, mode: "insensitive" } },
            { order: { orderNumber: { contains: search.toUpperCase() } } },
            { garment: { garmentCode: { contains: search.toUpperCase() } } },
          ],
        }
      : {}),
  };

  const [complaints, total, openCount, criticalCount, resolvedCount, branches, assignees] =
    await Promise.all([
      prisma.complaint.findMany({
        where,
        orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        include: {
          order: { select: { id: true, orderNumber: true } },
          garment: { select: { garmentCode: true } },
          assignedTo: { select: { name: true } },
        },
      }),
      prisma.complaint.count({ where }),
      prisma.complaint.count({
        where: {
          firmId,
          status: { in: ["OPEN", "UNDER_INVESTIGATION"] },
          ...(branchId ? { branchId } : {}),
        },
      }),
      prisma.complaint.count({
        where: {
          firmId,
          priority: "CRITICAL",
          status: { notIn: ["RESOLVED", "CLOSED", "REJECTED"] },
          ...(branchId ? { branchId } : {}),
        },
      }),
      prisma.complaint.count({
        where: { firmId, status: "RESOLVED", ...(branchId ? { branchId } : {}) },
      }),
      branchOptions(user),
      prisma.user.findMany({
        where: {
          firmId,
          status: "ACTIVE",
          role: { in: ["SUPER_ADMIN", "MANAGER"] },
          ...(branchId ? { branchId } : {}),
        },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
    ]);

  const rows: ComplaintRow[] = complaints.map((complaint) => ({
    id: complaint.id,
    complaintNumber: complaint.complaintNumber,
    type: complaint.type,
    status: complaint.status,
    priority: complaint.priority,
    raisedByName: complaint.raisedByName,
    orderId: complaint.order?.id ?? null,
    orderNumber: complaint.order?.orderNumber ?? null,
    garmentCode: complaint.garment?.garmentCode ?? null,
    assignedTo: complaint.assignedTo?.name ?? null,
    createdAt: complaint.createdAt,
  }));

  const columns: Column<ComplaintRow>[] = [
    {
      key: "number",
      header: "Complaint",
      cell: (row) => (
        <div className="space-y-0.5">
          <Link
            href={`/complaints/${row.id}`}
            className="font-mono text-sm font-semibold text-primary hover:underline"
          >
            {row.complaintNumber}
          </Link>
          <p className="text-xs text-muted-foreground">{humanize(row.type)}</p>
        </div>
      ),
    },
    {
      key: "reference",
      header: "Reference",
      cell: (row) => (
        <div className="space-y-0.5 text-sm">
          {row.orderId ? (
            <Link href={`/orders/${row.orderId}`} className="font-mono hover:underline">
              {row.orderNumber}
            </Link>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
          {row.garmentCode ? (
            <Link
              href={`/garments/${row.garmentCode}`}
              className="block font-mono text-xs text-muted-foreground hover:underline"
            >
              {row.garmentCode}
            </Link>
          ) : null}
        </div>
      ),
    },
    {
      key: "raisedBy",
      header: "Raised by",
      hideOnMobile: true,
      cell: (row) => <span className="text-sm">{row.raisedByName}</span>,
    },
    { key: "priority", header: "Priority", cell: (row) => <StatusBadge status={row.priority} /> },
    { key: "status", header: "Status", cell: (row) => <StatusBadge status={row.status} dot /> },
    {
      key: "assigned",
      header: "Assigned",
      hideOnMobile: true,
      cell: (row) => (
        <span className="text-sm text-muted-foreground">{row.assignedTo ?? "Unassigned"}</span>
      ),
    },
    {
      key: "created",
      header: "Raised",
      cell: (row) => (
        <span className="text-sm text-muted-foreground">{formatDate(row.createdAt)}</span>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Complaints & damage"
        description="Every issue raised, its investigation and how it was put right."
        actions={
          hasPermission(user, PERMISSIONS.COMPLAINT_CREATE) ? (
            <NewComplaintDialog
              branches={branches}
              defaultBranchId={user.branchId}
              assignees={assignees}
            />
          ) : null
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard
          label="Open"
          value={openCount}
          icon={MessageSquareWarning}
          tone={openCount > 0 ? "warning" : "default"}
        />
        <StatCard
          label="Critical"
          value={criticalCount}
          tone={criticalCount > 0 ? "danger" : "default"}
        />
        <StatCard label="Resolved" value={resolvedCount} tone="success" />
      </div>

      <FilterBar
        searchPlaceholder="Complaint number, order, garment, customer…"
        filters={[
          {
            name: "status",
            label: "Status",
            options: enumOptions([
              "OPEN",
              "UNDER_INVESTIGATION",
              "AWAITING_CUSTOMER",
              "RESOLVED",
              "REJECTED",
              "CLOSED",
            ] as const),
          },
          {
            name: "type",
            label: "Type",
            options: enumOptions([
              "DAMAGED_GARMENT",
              "LOST_GARMENT",
              "MISSING_GARMENT",
              "COLOR_FADING",
              "STAIN_NOT_REMOVED",
              "WRONG_GARMENT",
              "WRONG_QUANTITY",
              "LATE_DELIVERY",
              "OTHER",
            ] as const),
          },
          {
            name: "priority",
            label: "Priority",
            options: enumOptions(["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const),
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
        rowClassName={(row) =>
          row.priority === "CRITICAL" && !["RESOLVED", "CLOSED"].includes(row.status)
            ? "bg-destructive/4"
            : undefined
        }
        empty={
          <EmptyState
            icon={MessageSquareWarning}
            title="No complaints"
            description="Nothing has been raised under these filters — which is good news."
          />
        }
      />

      <Pagination page={page} pageSize={PAGE_SIZE} total={total} />
    </div>
  );
}
