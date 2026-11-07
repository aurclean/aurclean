import Link from "next/link";
import { AlertTriangle, Boxes, PackageOpen } from "lucide-react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { DataTable, type Column } from "@/components/shared/data-table";
import { RowActions } from "@/components/shared/row-actions";
import { toggleInventoryItemAction } from "@/app/(app)/inventory/actions";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import {
  NewItemDialog,
  StockMovementDialog,
  TransferStockDialog,
} from "@/app/(app)/inventory/inventory-dialogs";
import { prisma } from "@/lib/prisma";
import { formatCurrency, num } from "@/lib/money";
import { formatDateTime } from "@/lib/dates";
import { lowStockItems } from "@/lib/services/inventory";
import { PERMISSIONS } from "@/lib/rbac";
import { hasPermission, requireFirmId, requirePermission } from "@/lib/session";
import { humanize } from "@/lib/utils";
import {
  branchOptions,
  enumOptions,
  param,
  scopedBranchId,
  type SearchParams,
} from "@/lib/queries/filters";
import type { Prisma } from "@/generated/prisma/client";

export const metadata = { title: "Inventory" };

const CATEGORIES = [
  "DETERGENT",
  "BLEACH",
  "FABRIC_SOFTENER",
  "STAIN_REMOVER",
  "CHEMICAL",
  "PACKAGING",
  "HANGER",
  "COVER",
  "TAG",
  "LABEL",
  "OTHER",
] as const;

interface StockRow {
  id: string;
  itemId: string;
  isActive: boolean;
  sku: string;
  name: string;
  category: string;
  unit: string;
  quantity: number;
  minStockLevel: number;
  costPrice: number;
  branchName: string;
  isLow: boolean;
}

interface MovementRow {
  id: string;
  itemName: string;
  sku: string;
  type: string;
  quantity: number;
  balanceAfter: number;
  unit: string;
  branchName: string;
  reference: string | null;
  user: string | null;
  createdAt: Date;
}

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const user = await requirePermission(PERMISSIONS.INVENTORY_VIEW);

  const branchId = scopedBranchId(user, params);
  const firmId = requireFirmId(user);
  const tab = param(params, "tab") ?? "stock";
  const search = param(params, "q");
  const category = param(params, "category");

  const stockWhere: Prisma.InventoryStockWhereInput = {
    ...(branchId ? { branchId } : {}),
    item: {
      firmId,
      isActive: true,
      ...(category && category !== "all" ? { category: category as never } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" } },
              { sku: { contains: search.toUpperCase() } },
            ],
          }
        : {}),
    },
  };

  const [stocks, movements, items, branches, lowStock, totalValue] = await Promise.all([
    prisma.inventoryStock.findMany({
      where: stockWhere,
      orderBy: [{ item: { category: "asc" } }, { item: { name: "asc" } }],
      take: 200,
      include: {
        item: true,
        branch: { select: { name: true } },
      },
    }),
    prisma.inventoryTransaction.findMany({
      where: { item: { firmId }, ...(branchId ? { branchId } : {}) },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        item: { select: { name: true, sku: true, unit: true } },
        branch: { select: { name: true } },
        user: { select: { name: true } },
      },
    }),
    prisma.inventoryItem.findMany({
      where: { firmId, isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, sku: true, unit: true },
    }),
    branchOptions(user),
    lowStockItems(firmId, branchId),
    prisma.inventoryStock.findMany({
      where: { item: { firmId }, ...(branchId ? { branchId } : {}) },
      include: { item: { select: { costPrice: true } } },
    }),
  ]);

  const stockValue = totalValue.reduce(
    (sum, stock) => sum + num(stock.quantity) * num(stock.item.costPrice),
    0,
  );

  const rows: StockRow[] = stocks.map((stock) => ({
    id: stock.id,
    itemId: stock.item.id,
    isActive: stock.item.isActive,
    sku: stock.item.sku,
    name: stock.item.name,
    category: stock.item.category,
    unit: stock.item.unit,
    quantity: num(stock.quantity),
    minStockLevel: num(stock.item.minStockLevel),
    costPrice: num(stock.item.costPrice),
    branchName: stock.branch.name,
    isLow: num(stock.quantity) <= num(stock.item.minStockLevel),
  }));

  const movementRows: MovementRow[] = movements.map((movement) => ({
    id: movement.id,
    itemName: movement.item.name,
    sku: movement.item.sku,
    type: movement.type,
    quantity: num(movement.quantity),
    balanceAfter: num(movement.balanceAfter),
    unit: movement.item.unit,
    branchName: movement.branch.name,
    reference: movement.reference,
    user: movement.user?.name ?? null,
    createdAt: movement.createdAt,
  }));

  const canManage = hasPermission(user, PERMISSIONS.INVENTORY_MANAGE);
  const canTransfer = hasPermission(user, PERMISSIONS.INVENTORY_TRANSFER);
  const canAdjust = hasPermission(user, PERMISSIONS.INVENTORY_ADJUST);

  const stockColumns: Column<StockRow>[] = [
    {
      key: "item",
      header: "Item",
      cell: (row) => (
        <div className="space-y-0.5">
          <p className="text-sm font-medium">{row.name}</p>
          <p className="font-mono text-xs text-muted-foreground">{row.sku}</p>
        </div>
      ),
    },
    {
      key: "category",
      header: "Category",
      hideOnMobile: true,
      cell: (row) => <Badge tone="neutral">{humanize(row.category)}</Badge>,
    },
    ...(branches.length > 1
      ? [
          {
            key: "branch",
            header: "Branch",
            hideOnMobile: true,
            cell: (row: StockRow) => (
              <span className="text-sm text-muted-foreground">{row.branchName}</span>
            ),
          } satisfies Column<StockRow>,
        ]
      : []),
    {
      key: "quantity",
      header: "On hand",
      className: "text-right",
      headerClassName: "text-right",
      cell: (row) => (
        <span
          className={`text-sm font-semibold numeric ${row.isLow ? "text-destructive" : ""}`}
        >
          {row.quantity} {row.unit}
        </span>
      ),
    },
    {
      key: "min",
      header: "Minimum",
      className: "text-right",
      headerClassName: "text-right",
      hideOnMobile: true,
      cell: (row) => (
        <span className="text-sm text-muted-foreground numeric">
          {row.minStockLevel} {row.unit}
        </span>
      ),
    },
    {
      key: "value",
      header: "Value",
      className: "text-right",
      headerClassName: "text-right",
      cell: (row) => (
        <span className="text-sm numeric">
          {formatCurrency(row.quantity * row.costPrice)}
        </span>
      ),
    },
    {
      key: "flag",
      header: "",
      cell: (row) => (row.isLow ? <StatusBadge status="LOW" tone="danger" label="Low" /> : null),
    },
    {
      key: "actions",
      header: "",
      className: "text-right",
      cell: (row) => (
        <RowActions
          viewHref={`/inventory/${row.itemId}`}
          extra={[
            { label: "Record movement", icon: "arrowRight", href: `/inventory?move=${row.itemId}` },
            { label: "Purchase orders", icon: "list", href: "/purchases" },
          ]}
          remove={
            canManage
              ? {
                  subject: row.name,
                  confirmLabel: row.isActive ? "Archive item" : "Restore item",
                  successMessage: row.isActive
                    ? `${row.name} archived`
                    : `${row.name} restored`,
                  impact: row.isActive ? (
                    <>
                      <p>
                        {row.name} comes off the ordering and issuing lists. Its stock
                        balances and its whole movement ledger are kept.
                      </p>
                      <p>Restore it here whenever you start carrying it again.</p>
                    </>
                  ) : (
                    <p>{row.name} goes back on the ordering and issuing lists.</p>
                  ),
                  action: toggleInventoryItemAction.bind(null, row.itemId, !row.isActive),
                }
              : undefined
          }
        />
      ),
    },
  ];

  const movementColumns: Column<MovementRow>[] = [
    {
      key: "when",
      header: "When",
      cell: (row) => (
        <span className="text-sm text-muted-foreground">{formatDateTime(row.createdAt)}</span>
      ),
    },
    {
      key: "item",
      header: "Item",
      cell: (row) => (
        <div className="space-y-0.5">
          <p className="text-sm">{row.itemName}</p>
          <p className="font-mono text-xs text-muted-foreground">{row.sku}</p>
        </div>
      ),
    },
    { key: "type", header: "Type", cell: (row) => <Badge tone="neutral">{humanize(row.type)}</Badge> },
    ...(branches.length > 1
      ? [
          {
            key: "branch",
            header: "Branch",
            hideOnMobile: true,
            cell: (row: MovementRow) => (
              <span className="text-sm text-muted-foreground">{row.branchName}</span>
            ),
          } satisfies Column<MovementRow>,
        ]
      : []),
    {
      key: "qty",
      header: "Change",
      className: "text-right",
      headerClassName: "text-right",
      cell: (row) => (
        <span
          className={`text-sm font-medium numeric ${
            ["STOCK_OUT", "TRANSFER_OUT", "CONSUMPTION", "WASTAGE"].includes(row.type)
              ? "text-destructive"
              : "text-success"
          }`}
        >
          {["STOCK_OUT", "TRANSFER_OUT", "CONSUMPTION", "WASTAGE"].includes(row.type)
            ? "−"
            : "+"}
          {Math.abs(row.quantity)} {row.unit}
        </span>
      ),
    },
    {
      key: "balance",
      header: "Balance",
      className: "text-right",
      headerClassName: "text-right",
      cell: (row) => (
        <span className="text-sm numeric">
          {row.balanceAfter} {row.unit}
        </span>
      ),
    },
    {
      key: "by",
      header: "By",
      hideOnMobile: true,
      cell: (row) => (
        <div className="text-xs text-muted-foreground">
          <p>{row.user ?? "—"}</p>
          {row.reference ? <p>{row.reference}</p> : null}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Inventory"
        description="Consumables, branch-wise stock and the movement ledger behind it."
        actions={
          <>
            {canManage ? (
              <StockMovementDialog
                items={items}
                branches={branches}
                defaultBranchId={user.branchId}
                canAdjust={canAdjust}
              />
            ) : null}
            {canTransfer && branches.length > 1 ? (
              <TransferStockDialog
                items={items}
                branches={branches}
                defaultBranchId={user.branchId}
              />
            ) : null}
            {canManage ? <NewItemDialog /> : null}
          </>
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Tracked items" value={items.length} icon={Boxes} />
        <StatCard
          label="Stock value"
          value={formatCurrency(stockValue)}
          icon={PackageOpen}
          tone="info"
        />
        <StatCard
          label="Low stock"
          value={lowStock.length}
          icon={AlertTriangle}
          tone={lowStock.length > 0 ? "danger" : "success"}
          href="/inventory?tab=low"
        />
      </div>

      <Tabs value={tab}>
        <TabsList>
          <TabsTrigger value="stock" asChild>
            <Link href="/inventory?tab=stock">Stock</Link>
          </TabsTrigger>
          <TabsTrigger value="movements" asChild>
            <Link href="/inventory?tab=movements">Movements</Link>
          </TabsTrigger>
          <TabsTrigger value="low" asChild>
            <Link href="/inventory?tab=low">Low stock ({lowStock.length})</Link>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="stock" className="space-y-4">
          <FilterBar
            searchPlaceholder="Item name or SKU…"
            filters={[
              { name: "category", label: "Category", options: enumOptions(CATEGORIES) },
              ...(branches.length > 1
                ? [{ name: "branch", label: "Branch", options: branches }]
                : []),
            ]}
          />
          <DataTable
            columns={stockColumns}
            rows={rows}
            getRowKey={(row) => row.id}
            rowClassName={(row) => (row.isLow ? "bg-destructive/4" : undefined)}
            empty={
              <EmptyState
                icon={Boxes}
                title="No stock records"
                description="Add items and record a stock-in to start tracking consumables."
              />
            }
          />
        </TabsContent>

        <TabsContent value="movements">
          <DataTable
            columns={movementColumns}
            rows={movementRows}
            getRowKey={(row) => row.id}
            empty={
              <EmptyState
                icon={PackageOpen}
                title="No movements yet"
                description="Stock in, stock out, transfers and adjustments all land here."
              />
            }
          />
        </TabsContent>

        <TabsContent value="low">
          {lowStock.length === 0 ? (
            <EmptyState
              icon={AlertTriangle}
              title="Everything is above its minimum"
              description="No item has fallen to its reorder level."
            />
          ) : (
            <ul className="space-y-2">
              {lowStock.map((entry) => (
                <li
                  key={`${entry.itemId}-${entry.branchId}`}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{entry.name}</p>
                    <p className="font-mono text-xs text-muted-foreground">
                      {entry.sku} · {entry.branchName}
                    </p>
                  </div>
                  <p className="text-sm numeric">
                    <span className="font-semibold text-destructive">
                      {entry.quantity} {entry.unit}
                    </span>
                    <span className="text-muted-foreground">
                      {" "}
                      / min {entry.minStockLevel} {entry.unit}
                    </span>
                  </p>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
