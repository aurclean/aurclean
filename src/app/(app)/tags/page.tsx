import Link from "next/link";
import { Printer, Tag } from "lucide-react";

import { DataTable, type Column } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { PageHeader } from "@/components/shared/page-header";
import { Pagination } from "@/components/shared/pagination";
import { StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { prisma } from "@/lib/prisma";
import { formatCurrency, num } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/dates";
import { PERMISSIONS } from "@/lib/rbac";
import { hasPermission, requireFirmId, requirePermission } from "@/lib/session";
import { pageParam, param, type SearchParams } from "@/lib/queries/filters";
import { ORDER_STATUS_LABELS } from "@/lib/workflow";
import type { OrderStatus } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";

export const metadata = { title: "Print tags" };

const PAGE_SIZE = 25;

interface Row {
  id: string;
  orderNumber: string;
  customerName: string;
  customerPhone: string;
  status: OrderStatus;
  placedAt: Date;
  expectedDeliveryAt: Date;
  totalPieces: number;
  outstandingAmount: number;
  tagPrintCount: number;
  tagLastPrintedAt: Date | null;
}

/**
 * The print queue behind the dashboard's Print Tag action. A tag always belongs
 * to an order, so this is where the counter picks one — newest first, because
 * the tag you need is almost always the order you just booked.
 */
export default async function PrintTagsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const user = await requirePermission(PERMISSIONS.GARMENT_VIEW);

  const search = param(params, "q");
  const printed = param(params, "printed");
  const page = pageParam(params);

  const seesAllBranches = hasPermission(user, PERMISSIONS.DASHBOARD_VIEW_ALL_BRANCHES);
  const firmId = requireFirmId(user);

  const where: Prisma.OrderWhereInput = {
    firmId,
    ...(seesAllBranches ? {} : { branchId: user.branchId ?? "__none__" }),
    ...(printed === "never" ? { tagPrintCount: 0 } : {}),
    ...(printed === "done" ? { tagPrintCount: { gt: 0 } } : {}),
    ...(search
      ? {
          OR: [
            { orderNumber: { contains: search, mode: "insensitive" } },
            { customerName: { contains: search, mode: "insensitive" } },
            { customerPhone: { contains: search.replace(/\D/g, "") || search } },
          ],
        }
      : {}),
  };

  const [orders, total, unprinted] = await Promise.all([
    prisma.order.findMany({
      where,
      orderBy: { placedAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        orderNumber: true,
        customerName: true,
        customerPhone: true,
        status: true,
        placedAt: true,
        expectedDeliveryAt: true,
        totalPieces: true,
        outstandingAmount: true,
        tagPrintCount: true,
        tagLastPrintedAt: true,
      },
    }),
    prisma.order.count({ where }),
    prisma.order.count({
      where: {
        firmId,
        ...(seesAllBranches ? {} : { branchId: user.branchId ?? "__none__" }),
        tagPrintCount: 0,
        status: { notIn: ["DELIVERED", "CANCELLED", "REFUNDED"] },
      },
    }),
  ]);

  const rows: Row[] = orders.map((order) => ({
    ...order,
    outstandingAmount: num(order.outstandingAmount),
  }));

  const columns: Column<Row>[] = [
    {
      key: "order",
      header: "Order",
      cell: (row) => (
        <div className="min-w-0 space-y-0.5">
          <Link
            href={`/orders/${row.id}`}
            className="block font-mono text-sm font-medium text-primary hover:underline"
          >
            {row.orderNumber}
          </Link>
          <p className="truncate text-xs text-muted-foreground">
            {row.customerName} · {row.customerPhone}
          </p>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (row) => (
        <StatusBadge status={row.status} label={ORDER_STATUS_LABELS[row.status]} />
      ),
    },
    {
      key: "pieces",
      header: "Pieces",
      className: "text-right",
      headerClassName: "text-right",
      cell: (row) => <span className="text-sm numeric">{row.totalPieces}</span>,
    },
    {
      key: "due",
      header: "Due",
      hideOnMobile: true,
      cell: (row) => (
        <span className="text-sm text-muted-foreground">
          {formatDate(row.expectedDeliveryAt)}
        </span>
      ),
    },
    {
      key: "balance",
      header: "Balance",
      className: "text-right",
      headerClassName: "text-right",
      hideOnMobile: true,
      cell: (row) => (
        <span
          className={`text-sm numeric ${row.outstandingAmount > 0 ? "font-medium text-destructive" : "text-muted-foreground"}`}
        >
          {formatCurrency(row.outstandingAmount)}
        </span>
      ),
    },
    {
      key: "printed",
      header: "Tag",
      cell: (row) =>
        row.tagPrintCount === 0 ? (
          <Badge tone="warning">Not printed</Badge>
        ) : (
          <span className="text-xs text-muted-foreground">
            {row.tagPrintCount}× · {formatDateTime(row.tagLastPrintedAt)}
          </span>
        ),
    },
    {
      key: "actions",
      header: "",
      className: "text-right",
      cell: (row) => (
        <Button asChild size="sm" variant={row.tagPrintCount === 0 ? "default" : "outline"}>
          <Link href={`/orders/${row.id}/tags`}>
            <Printer /> {row.tagPrintCount === 0 ? "Print tag" : "Reprint"}
          </Link>
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Print tags"
        description={
          unprinted > 0
            ? `${unprinted} open order${unprinted === 1 ? "" : "s"} still without a printed tag.`
            : "Every open order has a printed tag."
        }
      />

      <FilterBar
        searchPlaceholder="Order number, customer name or phone…"
        filters={[
          {
            name: "printed",
            label: "Tag",
            options: [
              { value: "never", label: "Never printed" },
              { value: "done", label: "Already printed" },
            ],
          },
        ]}
      />

      <DataTable
        columns={columns}
        rows={rows}
        getRowKey={(row) => row.id}
        empty={
          <EmptyState
            icon={Tag}
            title="Nothing to print"
            description="Book an order and its tag becomes available here."
          />
        }
      />

      <Pagination page={page} pageSize={PAGE_SIZE} total={total} />
    </div>
  );
}
