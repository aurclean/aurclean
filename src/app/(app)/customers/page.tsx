import Link from "next/link";
import { BadgeIndianRupee, Repeat, Users, Wallet } from "lucide-react";

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
import { PageHeader } from "@/components/shared/page-header";
import { Pagination } from "@/components/shared/pagination";
import { StatCard } from "@/components/shared/stat-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { prisma } from "@/lib/prisma";
import { formatCurrency, num } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { PERMISSIONS } from "@/lib/rbac";
import { hasPermission, requireFirmId, requirePermission } from "@/lib/session";
import { branchOptions, pageParam, param, type SearchParams } from "@/lib/queries/filters";
import { listCustomers, type CustomerSort } from "@/lib/services/customers";

import { deleteCustomerAction } from "./actions";
import { NewCustomerDialog } from "./customer-dialogs";

export const metadata = { title: "Customers" };

const SORTS = [
  { value: "recent", label: "Most recent order" },
  { value: "name", label: "Name" },
  { value: "spend", label: "Lifetime spend" },
  { value: "outstanding", label: "Balance owed" },
];

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const user = await requirePermission(PERMISSIONS.CUSTOMER_VIEW);

  const search = param(params, "q");
  const dirParam = param(params, "dir");
  const dir = dirParam === "asc" || dirParam === "desc" ? dirParam : undefined;
  const requested = param(params, "sort") ?? "recent";
  const sort = (
    ["recent", "name", "spend", "outstanding", "orders"].includes(requested)
      ? requested
      : "recent"
  ) as CustomerSort;
  const onlyOutstanding = param(params, "balance") === "owing";
  const page = pageParam(params);

  const seesAllBranches = hasPermission(user, PERMISSIONS.DASHBOARD_VIEW_ALL_BRANCHES);
  const branchIds = seesAllBranches ? null : user.branchId ? [user.branchId] : [];
  const firmId = requireFirmId(user);

  const [{ rows, total, pageSize }, branches, totals] = await Promise.all([
    listCustomers({
      firmId,
      branchIds,
      search,
      sort: sort as CustomerSort,
      // Only a column header sets a direction; the dropdown leaves it to the
      // sensible default for the field it picked.
      direction: dir,
      onlyOutstanding,
      page,
      pageSize: 25,
    }),
    branchOptions(user),
    prisma.customer.aggregate({
      where: { firmId, ...(branchIds ? { branchId: { in: branchIds } } : {}) },
      _count: { _all: true },
      _sum: { totalSpent: true, outstandingAmount: true },
    }),
  ]);

  const repeatCount = await prisma.customer.count({
    where: {
      firmId,
      ...(branchIds ? { branchId: { in: branchIds } } : {}),
      orderCount: { gt: 1 },
    },
  });

  const canManage = hasPermission(user, PERMISSIONS.CUSTOMER_MANAGE);

  const columns: Column<(typeof rows)[number]>[] = [
    {
      key: "customer",
      header: "Customer",
      sortKey: "name",
      cell: (row) => (
        <div className="min-w-0 space-y-0.5">
          <Link
            href={`/customers/${row.id}`}
            className="block truncate text-sm font-medium text-primary hover:underline"
          >
            {row.name}
          </Link>
          <p className="font-mono text-xs text-muted-foreground">
            {row.phone} · {row.code}
          </p>
        </div>
      ),
    },
    {
      key: "repeat",
      header: "Type",
      cell: (row) =>
        row.isRepeat ? (
          <Badge tone="success" className="gap-1">
            <Repeat className="size-3" /> Repeat
          </Badge>
        ) : (
          <Badge tone="neutral">New</Badge>
        ),
    },
    {
      key: "branch",
      header: "Branch",
      hideOnMobile: true,
      toggleLabel: "Branch",
      cell: (row) => <span className="text-sm text-muted-foreground">{row.branchName}</span>,
    },
    {
      key: "orders",
      header: "Orders",
      sortKey: "orders",
      className: "text-right",
      headerClassName: "text-right",
      cell: (row) => <span className="text-sm numeric">{row.orderCount}</span>,
    },
    {
      key: "spend",
      header: "Lifetime spend",
      sortKey: "spend",
      toggleLabel: "Lifetime spend",
      className: "text-right",
      headerClassName: "text-right",
      cell: (row) => (
        <span className="text-sm numeric">{formatCurrency(row.totalSpent)}</span>
      ),
    },
    {
      key: "balance",
      header: "Balance",
      sortKey: "outstanding",
      className: "text-right",
      headerClassName: "text-right",
      cell: (row) => (
        <span
          className={`text-sm numeric ${row.outstandingAmount > 0 ? "font-medium text-destructive" : "text-muted-foreground"}`}
        >
          {formatCurrency(row.outstandingAmount)}
        </span>
      ),
    },
    {
      key: "last",
      header: "Last order",
      sortKey: "recent",
      hideOnMobile: true,
      toggleLabel: "Last order",
      cell: (row) => (
        <span className="text-sm text-muted-foreground">
          {row.lastOrderAt ? formatDate(row.lastOrderAt) : "—"}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      className: "text-right",
      cell: (row) => (
        <RowActions
          viewHref={`/customers/${row.id}`}
          editHref={`/customers/${row.id}?edit=1`}
          extra={[
            {
              label: "New order",
              icon: "plus" as const,
              href: `/orders/new?customer=${row.id}`,
            },
            {
              label: "Their orders",
              icon: "list" as const,
              href: `/orders?q=${encodeURIComponent(row.phone)}`,
            },
          ]}
          remove={
            canManage
              ? {
                  subject: row.name,
                  confirmLabel: row.orderCount > 0 ? "Retire customer" : "Delete customer",
                  successMessage:
                    row.orderCount > 0 ? `${row.name} retired` : `${row.name} deleted`,
                  impact:
                    row.orderCount > 0 ? (
                      <>
                        <p>
                          {row.name} has {row.orderCount} order
                          {row.orderCount === 1 ? "" : "s"}, so the record is kept and taken
                          out of the pickers instead.
                        </p>
                        <p>Every order, payment and garment stays exactly as it is.</p>
                      </>
                    ) : (
                      <p>
                        This customer has never placed an order, so the record is removed
                        outright.
                      </p>
                    ),
                  action: deleteCustomerAction.bind(null, { customerId: row.id }),
                }
              : undefined
          }
        />
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Customers"
        description="Everyone who has walked in or booked a pickup, with what they have spent and what they still owe."
        actions={
          hasPermission(user, PERMISSIONS.CUSTOMER_MANAGE) ? (
            <NewCustomerDialog branches={branches} defaultBranchId={user.branchId} />
          ) : null
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Customers" value={totals._count._all} icon={Users} />
        <StatCard label="Repeat customers" value={repeatCount} icon={Repeat} tone="success" />
        <StatCard
          label="Lifetime revenue"
          value={formatCurrency(num(totals._sum.totalSpent))}
          icon={BadgeIndianRupee}
        />
        <StatCard
          label="Balance owed"
          value={formatCurrency(num(totals._sum.outstandingAmount))}
          icon={Wallet}
          tone={num(totals._sum.outstandingAmount) > 0 ? "warning" : "default"}
        />
      </div>

      <FilterBar
        searchPlaceholder="Name, phone, customer code or order number…"
        filters={[
          { name: "sort", label: "Sort", options: SORTS },
          {
            name: "balance",
            label: "Balance",
            options: [{ value: "owing", label: "Owing money" }],
          },
        ]}
      />

      <div className="flex justify-end">
        <ColumnToggle columns={toggleableColumns(columns)} />
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        getRowKey={(row) => row.id}
        hiddenColumns={hiddenColumnsFrom(param(params, "hide"))}
        renderMobileCard={(row) => (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Link
                href={`/customers/${row.id}`}
                className="font-medium text-sm text-primary hover:underline"
              >
                {row.name}
              </Link>
              <Badge tone="neutral" className="font-mono text-xs">
                {row.code}
              </Badge>
            </div>

            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <a href={`tel:${row.phone}`} className="font-mono text-primary hover:underline">
                📞 {row.phone}
              </a>
              <span>{row.orderCount} Orders</span>
            </div>

            <div className="flex items-center justify-between pt-1 text-xs border-t border-border/50">
              <span className="text-muted-foreground">Spent: {formatCurrency(num(row.totalSpent))}</span>
              <div className="text-right">
                {num(row.outstandingAmount) > 0 ? (
                  <span className="font-semibold text-destructive">Owes {formatCurrency(num(row.outstandingAmount))}</span>
                ) : (
                  <span className="text-emerald-600 dark:text-emerald-400 font-medium">Clear balance</span>
                )}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <Button asChild size="sm" variant="outline" className="h-8 text-xs">
                <Link href={`/customers/${row.id}`}>View Details</Link>
              </Button>
            </div>
          </div>
        )}
        empty={
          <EmptyState
            icon={Users}
            title={search ? "No customer matches that" : "No customers yet"}
            description={
              search
                ? "Try a phone number, a customer code, or an order number they placed."
                : "Customers are created automatically the first time an order is booked against a phone number."
            }
          />
        }
      />

      <Pagination page={page} pageSize={pageSize} total={total} />
    </div>
  );
}
