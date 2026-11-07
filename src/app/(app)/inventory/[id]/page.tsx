import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  Boxes,
  Package,
  TrendingDown,
  TrendingUp,
  Warehouse,
} from "lucide-react";

import { DataTable, type Column } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { prisma } from "@/lib/prisma";
import { formatCurrency, formatNumber, num } from "@/lib/money";
import { formatDateTime } from "@/lib/dates";
import { PERMISSIONS } from "@/lib/rbac";
import { hasPermission, requireFirmId, requirePermission } from "@/lib/session";
import { isGlobalRole } from "@/lib/rbac";
import { humanize } from "@/lib/utils";

export const metadata = { title: "Inventory item" };

interface MovementRow {
  id: string;
  type: string;
  quantity: number;
  balanceAfter: number;
  branchName: string;
  reference: string | null;
  notes: string | null;
  user: string | null;
  at: Date;
}

export default async function InventoryItemPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requirePermission(PERMISSIONS.INVENTORY_VIEW);

  const firmId = requireFirmId(user);
  const branchFilter = isGlobalRole(user.role)
    ? {}
    : { branchId: user.branchId ?? "__none__" };

  const item = await prisma.inventoryItem.findFirst({
    where: { firmId, OR: [{ id }, { sku: id }] },
    include: {
      stocks: {
        where: branchFilter,
        include: { branch: { select: { name: true, code: true } } },
        orderBy: { branch: { name: "asc" } },
      },
      transactions: {
        where: branchFilter,
        orderBy: { createdAt: "desc" },
        take: 40,
        include: {
          branch: { select: { name: true } },
          user: { select: { name: true } },
        },
      },
      _count: { select: { poItems: true, grnItems: true } },
    },
  });

  if (!item) notFound();

  const totalStock = item.stocks.reduce((sum, stock) => sum + num(stock.quantity), 0);
  const minLevel = num(item.minStockLevel);
  const value = totalStock * num(item.costPrice);
  const low = minLevel > 0 && totalStock <= minLevel;

  const rows: MovementRow[] = item.transactions.map((txn) => ({
    id: txn.id,
    type: txn.type,
    quantity: num(txn.quantity),
    balanceAfter: num(txn.balanceAfter),
    branchName: txn.branch.name,
    reference: txn.reference,
    notes: txn.notes,
    user: txn.user?.name ?? null,
    at: txn.createdAt,
  }));

  const columns: Column<MovementRow>[] = [
    {
      key: "type",
      header: "Movement",
      cell: (row) => (
        <div className="flex items-center gap-2">
          {row.quantity >= 0 ? (
            <TrendingUp className="size-4 text-success" />
          ) : (
            <TrendingDown className="size-4 text-destructive" />
          )}
          <StatusBadge status={row.type} label={humanize(row.type)} />
        </div>
      ),
    },
    {
      key: "quantity",
      header: "Qty",
      className: "text-right",
      headerClassName: "text-right",
      cell: (row) => (
        <span
          className={`text-sm numeric font-medium ${row.quantity >= 0 ? "text-success" : "text-destructive"}`}
        >
          {row.quantity >= 0 ? "+" : ""}
          {formatNumber(row.quantity, 3)} {item.unit}
        </span>
      ),
    },
    {
      key: "balance",
      header: "Balance",
      className: "text-right",
      headerClassName: "text-right",
      cell: (row) => (
        <span className="text-sm numeric">{formatNumber(row.balanceAfter, 3)}</span>
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
      key: "note",
      header: "Reference",
      hideOnMobile: true,
      toggleLabel: "Reference",
      cell: (row) => (
        <span className="text-sm text-muted-foreground">
          {row.reference ?? row.notes ?? "—"}
        </span>
      ),
    },
    {
      key: "when",
      header: "When",
      cell: (row) => (
        <span className="text-sm text-muted-foreground">
          {formatDateTime(row.at)}
          {row.user ? ` · ${row.user}` : ""}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title={item.name}
        description={`${item.sku} · ${humanize(item.category)} · priced per ${item.unit}`}
        actions={
          <>
            <Button asChild variant="outline" size="icon" aria-label="Back to inventory">
              <Link href="/inventory">
                <ArrowLeft />
              </Link>
            </Button>
            {hasPermission(user, PERMISSIONS.INVENTORY_MANAGE) ? (
              <Button asChild variant="outline">
                <Link href={`/inventory?edit=${item.id}`}>Edit item</Link>
              </Button>
            ) : null}
            {hasPermission(user, PERMISSIONS.INVENTORY_ADJUST) ? (
              <Button asChild>
                <Link href={`/inventory?move=${item.id}`}>Record movement</Link>
              </Button>
            ) : null}
          </>
        }
      />

      <div className="flex flex-wrap gap-2">
        {item.isActive ? (
          <Badge tone="success">Active</Badge>
        ) : (
          <Badge tone="neutral">Archived</Badge>
        )}
        {low ? <Badge tone="danger">Below reorder level</Badge> : null}
        {item._count.poItems > 0 ? (
          <Badge tone="outline">{item._count.poItems} purchase lines</Badge>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="On hand"
          value={`${formatNumber(totalStock, 3)} ${item.unit}`}
          icon={Boxes}
          tone={low ? "warning" : "default"}
          animate={false}
        />
        <StatCard
          label="Reorder level"
          value={`${formatNumber(minLevel, 3)} ${item.unit}`}
          icon={Package}
          animate={false}
        />
        <StatCard
          label="Cost price"
          value={formatCurrency(item.costPrice)}
          animate={false}
        />
        <StatCard label="Stock value" value={formatCurrency(value)} animate={false} />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Warehouse className="size-4" /> Where it is
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {item.stocks.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No stock recorded at any branch you can see.
              </p>
            ) : (
              item.stocks.map((stock) => {
                const quantity = num(stock.quantity);
                const pct =
                  minLevel > 0 ? Math.min(100, Math.round((quantity / (minLevel * 2)) * 100)) : 100;
                return (
                  <div key={stock.id} className="space-y-1">
                    <div className="flex items-baseline justify-between gap-2 text-sm">
                      <span>{stock.branch.name}</span>
                      <span className="numeric font-medium">
                        {formatNumber(quantity, 3)} {item.unit}
                      </span>
                    </div>
                    <Progress
                      value={pct}
                      indicatorClassName={
                        minLevel > 0 && quantity <= minLevel ? "bg-destructive" : "bg-success"
                      }
                    />
                  </div>
                );
              })
            )}
            {item.description ? (
              <p className="rounded-lg bg-muted px-3 py-2 text-sm">{item.description}</p>
            ) : null}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Movement ledger</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <DataTable
              columns={columns}
              rows={rows}
              getRowKey={(row) => row.id}
              className="rounded-none border-0"
              empty={
                <EmptyState
                  icon={Boxes}
                  title="Nothing has moved yet"
                  description="Receipts, issues, transfers and adjustments all appear here with a running balance."
                />
              }
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
