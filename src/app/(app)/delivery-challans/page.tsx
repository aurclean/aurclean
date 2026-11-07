import Link from "next/link";
import { Eye, FileText, Plus, Printer } from "lucide-react";

import { requireFirmId, requirePermission } from "@/lib/session";
import { PERMISSIONS } from "@/lib/rbac";
import { getDeliveryChallans, getChallanStats } from "@/lib/services/delivery-challan";
import { formatCurrency } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { Button } from "@/components/ui/button";
import {
  DataTable,
  hiddenColumnsFrom,
  toggleableColumns,
  type Column,
} from "@/components/shared/data-table";
import { ColumnToggle } from "@/components/shared/table-controls";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { PageHeader } from "@/components/shared/page-header";
import { Pagination } from "@/components/shared/pagination";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { CHALLAN_STATUS_LABELS } from "@/lib/workflow";
import { enumOptions, param, pageParam, type SearchParams } from "@/lib/queries/filters";
import type { ChallanStatus, PaymentStatus } from "@/generated/prisma/client";

export const metadata = {
  title: "Delivery Challans — AURCLEAN Laundry ERP",
  description: "Manage, track, generate, and print official Delivery Challans.",
};

const CHALLAN_STATUSES = Object.keys(CHALLAN_STATUS_LABELS) as ChallanStatus[];

interface ChallanRow {
  id: string;
  challanNumber: string;
  challanDate: Date;
  status: ChallanStatus;
  paymentStatus: PaymentStatus;
  grandTotal: unknown;
  customerName: string;
  customerPhone: string;
  order: { id: string; orderNumber: string };
  items: unknown[];
}

export default async function DeliveryChallansPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await requirePermission(PERMISSIONS.DELIVERY_VIEW);
  const params = await searchParams;

  const page = pageParam(params);
  const search = param(params, "q") ?? "";
  const status = (param(params, "status") ?? "ALL") as ChallanStatus | "ALL";
  const paymentStatus = (param(params, "paymentStatus") ?? "ALL") as PaymentStatus | "ALL";

  const branchId = session.role === "SUPER_ADMIN" ? undefined : session.branchId || undefined;
  const firmId = requireFirmId(session);

  const [{ challans, pagination }, stats] = await Promise.all([
    getDeliveryChallans({ firmId, page, limit: 15, search, status, paymentStatus, branchId }),
    getChallanStats(firmId, branchId),
  ]);

  const rows = challans as unknown as ChallanRow[];

  const columns: Column<ChallanRow>[] = [
    {
      key: "challanNumber",
      header: "Challan No",
      cell: (row) => (
        <Link
          href={`/delivery-challans/${row.id}`}
          className="font-mono text-sm font-semibold text-primary hover:underline"
        >
          {row.challanNumber}
        </Link>
      ),
    },
    {
      key: "order",
      header: "Order No",
      hideOnMobile: true,
      cell: (row) => (
        <Link
          href={`/orders/${row.order.id}`}
          className="font-mono text-sm font-medium hover:underline"
        >
          {row.order.orderNumber}
        </Link>
      ),
    },
    {
      key: "customer",
      header: "Customer",
      cell: (row) => (
        <div>
          <p className="font-medium">{row.customerName}</p>
          <p className="text-xs text-muted-foreground">{row.customerPhone}</p>
        </div>
      ),
    },
    {
      key: "items",
      header: "Items",
      hideOnMobile: true,
      cell: (row) => <span className="numeric">{row.items.length}</span>,
    },
    {
      key: "grandTotal",
      header: "Grand Total",
      cell: (row) => (
        <span className="numeric font-semibold">{formatCurrency(row.grandTotal as never)}</span>
      ),
    },
    {
      key: "paymentStatus",
      header: "Payment",
      cell: (row) => <StatusBadge status={row.paymentStatus} />,
    },
    {
      key: "status",
      header: "Status",
      cell: (row) => (
        <StatusBadge status={row.status} label={CHALLAN_STATUS_LABELS[row.status]} dot />
      ),
    },
    {
      key: "date",
      header: "Date",
      hideOnMobile: true,
      cell: (row) => (
        <span className="text-xs text-muted-foreground">{formatDate(row.challanDate)}</span>
      ),
    },
    {
      key: "actions",
      header: "",
      headerClassName: "text-right",
      className: "text-right",
      cell: (row) => (
        <div className="flex justify-end gap-1">
          <Button asChild variant="ghost" size="icon" aria-label="View challan">
            <Link href={`/delivery-challans/${row.id}`}>
              <Eye className="size-4" />
            </Link>
          </Button>
          <Button asChild variant="ghost" size="icon" aria-label="Print challan">
            <a
              href={`/api/documents/pdf?type=DELIVERY_CHALLAN&id=${row.id}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Printer className="size-4" />
            </a>
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Delivery Challans"
        description="Official delivery documentation, partial delivery tracking, and customer dispatch records."
        actions={
          <Button asChild>
            <Link href="/orders">
              <Plus /> Create Challan from Order
            </Link>
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Today's Challans" value={stats.todaysChallans} icon={FileText} />
        <StatCard
          label="Pending Delivery"
          value={stats.pendingDelivery}
          icon={FileText}
          tone={stats.pendingDelivery > 0 ? "warning" : "default"}
        />
        <StatCard
          label="Partially Delivered"
          value={stats.partiallyDelivered}
          icon={FileText}
          tone="info"
        />
        <StatCard
          label="Delivered Today"
          value={stats.deliveredToday}
          icon={FileText}
          tone="success"
        />
      </div>

      <FilterBar
        searchPlaceholder="Challan #, order #, customer name, phone…"
        filters={[
          {
            name: "status",
            label: "Status",
            allValue: "ALL",
            options: enumOptions(CHALLAN_STATUSES, CHALLAN_STATUS_LABELS),
          },
          {
            name: "paymentStatus",
            label: "Payment",
            allValue: "ALL",
            options: [
              { value: "UNPAID", label: "Unpaid" },
              { value: "PARTIALLY_PAID", label: "Partially Paid" },
              { value: "PAID", label: "Paid" },
            ],
          },
        ]}
      />

      <div className="flex justify-end">
        <ColumnToggle columns={toggleableColumns(columns)} />
      </div>

      <DataTable
        columns={columns}
        hiddenColumns={hiddenColumnsFrom(param(params, "hide"))}
        rows={rows}
        getRowKey={(row) => row.id}
        renderMobileCard={(row) => (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Link
                href={`/delivery-challans/${row.id}`}
                className="font-mono text-sm font-bold text-primary hover:underline"
              >
                {row.challanNumber}
              </Link>
              <StatusBadge status={row.status} label={CHALLAN_STATUS_LABELS[row.status]} dot />
            </div>

            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{row.customerName}</span>
              <a href={`tel:${row.customerPhone}`} className="font-mono text-primary hover:underline">
                📞 {row.customerPhone}
              </a>
            </div>

            <div className="flex items-center justify-between pt-1 text-xs border-t border-border/50">
              <span className="text-muted-foreground">Order: {row.order.orderNumber} ({row.items.length} items)</span>
              <div className="text-right font-semibold text-sm">
                {formatCurrency(row.grandTotal as never)}
              </div>
            </div>

            <div className="flex items-center justify-between pt-1">
              <span className="text-xs text-muted-foreground">{formatDate(row.challanDate)}</span>
              <div className="flex items-center gap-1">
                <Button asChild size="sm" variant="outline" className="h-8 text-xs">
                  <Link href={`/delivery-challans/${row.id}`}>View Details</Link>
                </Button>
                <Button asChild size="sm" variant="ghost" className="h-8 w-8 p-0">
                  <a
                    href={`/api/documents/pdf?type=DELIVERY_CHALLAN&id=${row.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Print PDF"
                  >
                    <Printer className="size-4" />
                  </a>
                </Button>
              </div>
            </div>
          </div>
        )}
        empty={
          <EmptyState
            icon={FileText}
            title="No Delivery Challans Found"
            description="No delivery challans match your search query or filter parameters."
            action={
              <Button asChild size="sm">
                <Link href="/orders">
                  <Plus /> Create Challan from Order
                </Link>
              </Button>
            }
          />
        }
      />

      <Pagination page={pagination.page} pageSize={pagination.limit} total={pagination.total} />
    </div>
  );
}
