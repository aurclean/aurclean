import Link from "next/link";
import { ScanLine, Shirt } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { PageHeader } from "@/components/shared/page-header";
import { Pagination } from "@/components/shared/pagination";
import { StatusBadge } from "@/components/shared/status-badge";
import { prisma } from "@/lib/prisma";
import { formatDateTime } from "@/lib/dates";
import { PERMISSIONS } from "@/lib/rbac";
import { hasPermission, requireFirmId, requirePermission } from "@/lib/session";
import {
  GARMENT_STATUS_LABELS,
  STAGE_LABELS,
  STAGE_ORDER,
} from "@/lib/workflow";
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
import type { GarmentStatus, ProcessingStage } from "@/generated/prisma/enums";

export const metadata = { title: "Garments" };

const GARMENT_STATUSES = Object.keys(GARMENT_STATUS_LABELS) as GarmentStatus[];

interface GarmentRow {
  id: string;
  garmentCode: string;
  orderId: string;
  orderNumber: string;
  customerName: string;
  typeName: string;
  serviceName: string;
  status: GarmentStatus;
  stage: ProcessingStage;
  lastScannedAt: Date | null;
  scannedBy: string | null;
  branchName: string;
}

export default async function GarmentsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const user = await requirePermission(PERMISSIONS.GARMENT_VIEW);

  const page = pageParam(params);
  const branchId = scopedBranchId(user, params);
  const firmId = requireFirmId(user);
  const search = param(params, "q");
  const status = param(params, "status");
  const stage = param(params, "stage");

  const where: Prisma.GarmentWhereInput = {
    firmId,
    ...(branchId ? { branchId } : {}),
    ...(status && status !== "all" ? { status: status as GarmentStatus } : {}),
    ...(stage && stage !== "all" ? { currentStage: stage as ProcessingStage } : {}),
    ...(search
      ? {
          OR: [
            { garmentCode: { contains: search.toUpperCase() } },
            { order: { orderNumber: { contains: search.toUpperCase() } } },
            { order: { customerName: { contains: search, mode: "insensitive" } } },
            { order: { customerPhone: { contains: search } } },
          ],
        }
      : {}),
  };

  const [garments, total, branches] = await Promise.all([
    prisma.garment.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        order: { select: { id: true, orderNumber: true, customerName: true } },
        garmentType: { select: { name: true } },
        service: { select: { name: true } },
        branch: { select: { name: true } },
        lastScannedBy: { select: { name: true } },
      },
    }),
    prisma.garment.count({ where }),
    branchOptions(user),
  ]);

  const rows: GarmentRow[] = garments.map((garment) => ({
    id: garment.id,
    garmentCode: garment.garmentCode,
    orderId: garment.order.id,
    orderNumber: garment.order.orderNumber,
    customerName: garment.order.customerName,
    typeName: garment.garmentType.name,
    serviceName: garment.service.name,
    status: garment.status,
    stage: garment.currentStage,
    lastScannedAt: garment.lastScannedAt,
    scannedBy: garment.lastScannedBy?.name ?? null,
    branchName: garment.branch.name,
  }));

  const columns: Column<GarmentRow>[] = [
    {
      key: "code",
      header: "Garment",
      cell: (row) => (
        <div className="space-y-0.5">
          <Link
            href={`/garments/${row.garmentCode}`}
            className="font-mono text-sm font-semibold text-primary hover:underline"
          >
            {row.garmentCode}
          </Link>
          <p className="text-xs text-muted-foreground">{row.typeName}</p>
        </div>
      ),
    },
    {
      key: "order",
      header: "Order",
      cell: (row) => (
        <div className="min-w-0 space-y-0.5">
          <Link
            href={`/orders/${row.orderId}`}
            className="font-mono text-sm hover:underline"
          >
            {row.orderNumber}
          </Link>
          <p className="truncate text-xs text-muted-foreground">{row.customerName}</p>
        </div>
      ),
    },
    {
      key: "service",
      header: "Service",
      hideOnMobile: true,
      cell: (row) => <span className="text-sm text-muted-foreground">{row.serviceName}</span>,
    },
    {
      key: "status",
      header: "Status",
      cell: (row) => (
        <StatusBadge status={row.status} label={GARMENT_STATUS_LABELS[row.status]} dot />
      ),
    },
    {
      key: "stage",
      header: "Stage",
      hideOnMobile: true,
      cell: (row) => (
        <span className="text-sm text-muted-foreground">{STAGE_LABELS[row.stage]}</span>
      ),
    },
    {
      key: "scan",
      header: "Last scan",
      hideOnMobile: true,
      cell: (row) =>
        row.lastScannedAt ? (
          <div className="text-xs text-muted-foreground">
            <p>{formatDateTime(row.lastScannedAt)}</p>
            {row.scannedBy ? <p>by {row.scannedBy}</p> : null}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Garments"
        description={`${total.toLocaleString("en-IN")} individually tracked garments.`}
        actions={
          hasPermission(user, PERMISSIONS.GARMENT_SCAN) ? (
            <Button asChild>
              <Link href="/scan">
                <ScanLine /> Scan
              </Link>
            </Button>
          ) : null
        }
      />

      <FilterBar
        searchPlaceholder="Garment code, order number, customer…"
        filters={[
          {
            name: "status",
            label: "Status",
            options: enumOptions(GARMENT_STATUSES, GARMENT_STATUS_LABELS),
          },
          {
            name: "stage",
            label: "Stage",
            options: enumOptions(STAGE_ORDER, STAGE_LABELS),
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
        renderMobileCard={(row) => (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Link
                href={`/garments/${row.garmentCode}`}
                className="font-mono text-sm font-bold text-primary hover:underline"
              >
                {row.garmentCode}
              </Link>
              <StatusBadge status={row.status} label={GARMENT_STATUS_LABELS[row.status]} dot />
            </div>

            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{row.typeName} · {row.serviceName}</span>
              <Link href={`/orders/${row.orderId}`} className="font-mono text-primary hover:underline">
                {row.orderNumber}
              </Link>
            </div>

            <div className="flex items-center justify-between pt-1 text-xs border-t border-border/50">
              <span className="text-muted-foreground">{row.customerName}</span>
              <span className="font-medium text-muted-foreground">{STAGE_LABELS[row.stage]}</span>
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <Button asChild size="sm" variant="outline" className="h-8 text-xs">
                <Link href={`/garments/${row.garmentCode}`}>Track Garment</Link>
              </Button>
            </div>
          </div>
        )}
        empty={
          <EmptyState
            icon={Shirt}
            title="No garments found"
            description="Garments appear here the moment an order is booked in."
          />
        }
      />

      <Pagination page={page} pageSize={PAGE_SIZE} total={total} />
    </div>
  );
}
