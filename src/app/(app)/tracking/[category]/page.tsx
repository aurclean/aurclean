import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowLeft, ScanLine, Shapes } from "lucide-react";

import {
  DataTable,
  hiddenColumnsFrom,
  toggleableColumns,
  type Column,
} from "@/components/shared/data-table";
import { RowActions } from "@/components/shared/row-actions";
import { ColumnToggle } from "@/components/shared/table-controls";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { LiveRefresh } from "@/components/shared/live-refresh";
import { PageHeader } from "@/components/shared/page-header";
import { Pagination } from "@/components/shared/pagination";
import { StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate, formatDateTime, formatRelative } from "@/lib/dates";
import { PERMISSIONS } from "@/lib/rbac";
import { hasPermission, requireFirmId, requirePermission } from "@/lib/session";
import { pageParam, param, type SearchParams } from "@/lib/queries/filters";
import { parseCategory, categorySlug } from "@/lib/garment-categories";
import {
  MISMATCH_LABELS,
  getCategoryPage,
  type TrackedGarment,
} from "@/lib/services/garment-tracking";
import { STAGE_LABELS, WORKSTATION_STAGES } from "@/lib/workflow";

export const metadata = { title: "Category tracking" };

export default async function CategoryTrackingPage({
  params,
  searchParams,
}: {
  params: Promise<{ category: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const [{ category: slug }, query] = await Promise.all([params, searchParams]);
  const category = parseCategory(slug);
  if (!category) notFound();

  const user = await requirePermission(PERMISSIONS.TRACKING_VIEW);
  const branchIds = hasPermission(user, PERMISSIONS.DASHBOARD_VIEW_ALL_BRANCHES)
    ? null
    : user.branchId
      ? [user.branchId]
      : [];
  const firmId = requireFirmId(user);

  const page = await getCategoryPage({
    firmId,
    category,
    branchIds,
    search: param(query, "q"),
    stage: param(query, "stage"),
    issueOnly: param(query, "issue") === "only",
    includeDelivered: param(query, "scope") === "all",
    page: pageParam(query),
  });

  const columns: Column<TrackedGarment>[] = [
    {
      key: "garment",
      header: "Garment",
      cell: (row) => (
        <div className="min-w-0 space-y-0.5">
          <Link
            href={`/garments/${row.garmentCode}`}
            className="block font-mono text-sm font-semibold text-primary hover:underline"
          >
            {row.garmentCode}
          </Link>
          <p className="truncate text-xs text-muted-foreground">{row.description}</p>
        </div>
      ),
    },
    {
      key: "order",
      header: "Order",
      cell: (row) => (
        <Link
          href={`/orders/${row.orderId}`}
          className="font-mono text-sm text-primary hover:underline"
        >
          {row.orderNumber}
        </Link>
      ),
    },
    {
      key: "customer",
      header: "Customer",
      cell: (row) => (
        <div className="min-w-0">
          {row.customerId ? (
            <Link
              href={`/customers/${row.customerId}`}
              className="block truncate text-sm hover:underline"
            >
              {row.customerName}
            </Link>
          ) : (
            <p className="truncate text-sm">{row.customerName}</p>
          )}
          <p className="font-mono text-xs text-muted-foreground">{row.customerPhone}</p>
        </div>
      ),
    },
    {
      key: "qty",
      header: "Qty",
      toggleLabel: "Qty",
      className: "text-right",
      headerClassName: "text-right",
      hideOnMobile: true,
      cell: (row) => <span className="text-sm numeric">{row.lineQuantity}</span>,
    },
    {
      key: "location",
      header: "Location",
      cell: (row) => (
        <div className="min-w-0">
          <StatusBadge status={row.status} label={row.statusLabel} />
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{row.location}</p>
        </div>
      ),
    },
    {
      key: "expected",
      header: "Expected",
      toggleLabel: "Expected",
      hideOnMobile: true,
      cell: (row) => (
        <span
          className={`text-sm ${row.isOverdue ? "font-medium text-destructive" : "text-muted-foreground"}`}
        >
          {formatDate(row.expectedDeliveryAt)}
        </span>
      ),
    },
    {
      key: "tag",
      header: "Tag",
      toggleLabel: "Tag",
      hideOnMobile: true,
      cell: (row) =>
        row.tagPrinted ? (
          <Badge tone="neutral">Printed</Badge>
        ) : (
          <Badge tone="warning">Not printed</Badge>
        ),
    },
    {
      key: "scan",
      header: "Scan",
      cell: (row) => (
        <div className="min-w-0">
          {row.scanState === "SCANNED" ? (
            <Badge tone="success">All scanned</Badge>
          ) : row.scanState === "STALE" ? (
            <Badge tone="warning">Gap in scans</Badge>
          ) : (
            <Badge tone="danger">Never scanned</Badge>
          )}
          {row.lastScannedAt ? (
            <p
              className="mt-0.5 truncate text-xs text-muted-foreground"
              title={formatDateTime(row.lastScannedAt)}
            >
              {formatRelative(row.lastScannedAt)}
            </p>
          ) : null}
        </div>
      ),
    },
    {
      key: "issue",
      header: "Condition",
      cell: (row) =>
        row.issue ? (
          <Link href={`/mismatch?q=${row.garmentCode}`}>
            <Badge tone="danger" className="gap-1">
              <AlertTriangle className="size-3" /> {MISMATCH_LABELS[row.issue]}
            </Badge>
          </Link>
        ) : (
          <Badge tone="success">OK</Badge>
        ),
    },
    {
      key: "actions",
      header: "",
      className: "text-right",
      cell: (row) => (
        <RowActions
          viewHref={`/garments/${row.garmentCode}`}
          extra={[
            { label: "Print tag", icon: "printer", href: `/orders/${row.orderId}/tags` },
            { label: "Scan station", icon: "scan", href: "/scan" },
            { label: "View order", icon: "list", href: `/orders/${row.orderId}` },
            ...(row.issue
              ? [
                  {
                    label: "Resolve mismatch",
                    icon: "rotate" as const,
                    href: `/mismatch?q=${row.garmentCode}`,
                  },
                ]
              : []),
          ]}
        />
      ),
    },
  ];

  const { summary } = page;
  const problems =
    summary.missing +
    summary.wrongOrder +
    summary.wrongGarment +
    summary.duplicate +
    summary.notScanned;

  return (
    <div className="space-y-5">
      <LiveRefresh intervalMs={20000} />
      <PageHeader
        title={`${page.emoji} ${page.label} — ${summary.total}`}
        description={`Every ${page.label.toLowerCase().replace(/s$/, "")} in the laundry right now, with the order and customer it belongs to.`}
        actions={
          <>
            <Button asChild variant="outline" size="icon" aria-label="All categories">
              <Link href="/tracking">
                <ArrowLeft />
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href={`/mismatch?category=${categorySlug(page.category)}`}>
                <AlertTriangle /> Mismatches
              </Link>
            </Button>
            <Button asChild>
              <Link href="/scan">
                <ScanLine /> Scan tag
              </Link>
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        <Tally label="Total" value={summary.total} tone="neutral" />
        <Tally label="Correct" value={summary.correct} tone="success" />
        <Tally label="Missing" value={summary.missing} tone="danger" />
        <Tally label="Wrong order" value={summary.wrongOrder} tone="danger" />
        <Tally label="Wrong garment" value={summary.wrongGarment} tone="danger" />
        <Tally label="Not scanned" value={summary.notScanned} tone="warning" />
      </div>

      <FilterBar
        searchPlaceholder="Garment id, order number, customer or phone…"
        filters={[
          {
            name: "stage",
            label: "Stage",
            options: WORKSTATION_STAGES.map((stage) => ({
              value: stage,
              label: STAGE_LABELS[stage],
            })),
          },
          {
            name: "issue",
            label: "Condition",
            options: [{ value: "only", label: "Needs attention" }],
          },
          {
            name: "scope",
            label: "Scope",
            options: [{ value: "all", label: "Include delivered" }],
          },
        ]}
      />

      <div className="flex justify-end">
        <ColumnToggle columns={toggleableColumns(columns)} />
      </div>

      <DataTable
        columns={columns}
        hiddenColumns={hiddenColumnsFrom(param(query, "hide"))}
        rows={page.rows}
        getRowKey={(row) => row.id}
        empty={
          <EmptyState
            icon={Shapes}
            title={`No ${page.label.toLowerCase()} match`}
            description={
              problems > 0
                ? "Clear the filters, or open the mismatch centre to see what needs attention."
                : "Nothing of this kind is in the laundry right now."
            }
          />
        }
      />

      <Pagination page={page.page} pageSize={page.pageSize} total={page.total} />
    </div>
  );
}

function Tally({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "neutral" | "success" | "danger" | "warning";
}) {
  const colour =
    value === 0
      ? "text-muted-foreground"
      : tone === "success"
        ? "text-success"
        : tone === "danger"
          ? "text-destructive"
          : tone === "warning"
            ? "text-warning-foreground"
            : "text-foreground";

  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2">
      <p className="truncate text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className={`text-xl font-semibold numeric ${colour}`}>{value}</p>
    </div>
  );
}
