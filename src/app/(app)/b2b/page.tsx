import Link from "next/link";
import { Building2, CreditCard, Receipt } from "lucide-react";

import { DataTable, type Column } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Progress } from "@/components/ui/progress";
import { NewAccountDialog } from "@/app/(app)/b2b/b2b-dialogs";
import { prisma } from "@/lib/prisma";
import { formatCurrency, num } from "@/lib/money";
import { PERMISSIONS } from "@/lib/rbac";
import { hasPermission, requireFirmId, requirePermission } from "@/lib/session";
import { humanize } from "@/lib/utils";
import {
  branchOptions,
  enumOptions,
  param,
  type SearchParams,
} from "@/lib/queries/filters";
import type { Prisma } from "@/generated/prisma/client";

export const metadata = { title: "B2B & Corporate" };

const TYPES = [
  "HOTEL",
  "HOSPITAL",
  "HOSTEL",
  "RESTAURANT",
  "SALON",
  "GYM",
  "CORPORATE",
  "OTHER",
] as const;

interface AccountRow {
  id: string;
  code: string;
  businessName: string;
  type: string;
  contactPerson: string | null;
  phone: string;
  creditLimit: number;
  outstanding: number;
  creditDays: number;
  isActive: boolean;
  orderCount: number;
  activeContracts: number;
}

export default async function B2BPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const user = await requirePermission(PERMISSIONS.B2B_VIEW);
  const firmId = requireFirmId(user);

  const search = param(params, "q");
  const type = param(params, "type");

  const where: Prisma.B2BAccountWhereInput = {
    firmId,
    ...(type && type !== "all" ? { type: type as never } : {}),
    ...(search
      ? {
          OR: [
            { businessName: { contains: search, mode: "insensitive" } },
            { code: { contains: search.toUpperCase() } },
            { phone: { contains: search } },
          ],
        }
      : {}),
  };

  const [accounts, branches, monthRevenue] = await Promise.all([
    prisma.b2BAccount.findMany({
      where,
      orderBy: { businessName: "asc" },
      include: {
        _count: { select: { orders: true } },
        contracts: { where: { status: "ACTIVE" }, select: { id: true } },
      },
    }),
    branchOptions(user),
    prisma.order.aggregate({
      where: {
        firmId,
        b2bAccountId: { not: null },
        status: { notIn: ["CANCELLED", "REFUNDED"] },
        placedAt: {
          gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
        },
      },
      _sum: { totalAmount: true },
    }),
  ]);

  const rows: AccountRow[] = accounts.map((account) => ({
    id: account.id,
    code: account.code,
    businessName: account.businessName,
    type: account.type,
    contactPerson: account.contactPerson,
    phone: account.phone,
    creditLimit: num(account.creditLimit),
    outstanding: num(account.outstandingBalance),
    creditDays: account.creditDays,
    isActive: account.isActive,
    orderCount: account._count.orders,
    activeContracts: account.contracts.length,
  }));

  const totalOutstanding = rows.reduce((sum, row) => sum + row.outstanding, 0);

  const columns: Column<AccountRow>[] = [
    {
      key: "account",
      header: "Account",
      cell: (row) => (
        <div className="min-w-0 space-y-0.5">
          <Link
            href={`/b2b/${row.id}`}
            className="block truncate text-sm font-medium text-primary hover:underline"
          >
            {row.businessName}
          </Link>
          <p className="font-mono text-xs text-muted-foreground">{row.code}</p>
        </div>
      ),
    },
    {
      key: "type",
      header: "Type",
      cell: (row) => <StatusBadge status={row.type} tone="neutral" label={humanize(row.type)} />,
    },
    {
      key: "contact",
      header: "Contact",
      hideOnMobile: true,
      cell: (row) => (
        <div className="text-sm text-muted-foreground">
          <p>{row.contactPerson ?? "—"}</p>
          <p className="font-mono text-xs">{row.phone}</p>
        </div>
      ),
    },
    {
      key: "contracts",
      header: "Contracts",
      hideOnMobile: true,
      className: "text-right",
      headerClassName: "text-right",
      cell: (row) => <span className="text-sm numeric">{row.activeContracts}</span>,
    },
    {
      key: "orders",
      header: "Orders",
      className: "text-right",
      headerClassName: "text-right",
      cell: (row) => <span className="text-sm numeric">{row.orderCount}</span>,
    },
    {
      key: "credit",
      header: "Credit used",
      cell: (row) => {
        const pct =
          row.creditLimit > 0
            ? Math.min(100, Math.round((row.outstanding / row.creditLimit) * 100))
            : 0;
        return (
          <div className="w-32 space-y-1">
            <div className="flex justify-between text-xs numeric">
              <span
                className={row.outstanding > 0 ? "font-medium text-destructive" : ""}
              >
                {formatCurrency(row.outstanding)}
              </span>
              <span className="text-muted-foreground">
                {row.creditLimit > 0 ? formatCurrency(row.creditLimit) : "no limit"}
              </span>
            </div>
            {row.creditLimit > 0 ? (
              <Progress
                value={pct}
                indicatorClassName={
                  pct > 90 ? "bg-destructive" : pct > 70 ? "bg-warning" : "bg-success"
                }
              />
            ) : null}
          </div>
        );
      },
    },
    {
      key: "status",
      header: "Status",
      cell: (row) => <StatusBadge status={row.isActive ? "ACTIVE" : "INACTIVE"} />,
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="B2B & corporate"
        description="Hotels, hospitals, hostels and other contracted bulk customers."
        actions={
          hasPermission(user, PERMISSIONS.B2B_MANAGE) ? (
            <NewAccountDialog branches={branches} defaultBranchId={user.branchId} />
          ) : null
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Accounts" value={accounts.length} icon={Building2} />
        <StatCard
          label="Credit outstanding"
          value={formatCurrency(totalOutstanding)}
          icon={CreditCard}
          tone={totalOutstanding > 0 ? "warning" : "default"}
        />
        <StatCard
          label="Corporate revenue this month"
          value={formatCurrency(monthRevenue._sum.totalAmount ?? 0)}
          icon={Receipt}
          tone="success"
        />
      </div>

      <FilterBar
        searchPlaceholder="Business name, code or phone…"
        filters={[{ name: "type", label: "Type", options: enumOptions(TYPES) }]}
      />

      <DataTable
        columns={columns}
        rows={rows}
        getRowKey={(row) => row.id}
        empty={
          <EmptyState
            icon={Building2}
            title="No corporate accounts"
            description="Add hotels, hospitals and other bulk customers to bill them on contract."
          />
        }
      />
    </div>
  );
}
