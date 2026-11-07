import Link from "next/link";
import { Download, PackageCheck, ScanLine, ShieldAlert, Shirt } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FilterBar } from "@/components/shared/filter-bar";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { CategoryBarChart } from "@/components/charts/category-bar-chart";
import { RevenueChart } from "@/components/charts/revenue-chart";
import { prisma } from "@/lib/prisma";
import { formatCurrency, num } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import {
  branchPerformance,
  deliveryMetrics,
  financeMetrics,
  garmentReport,
  operationsMetrics,
  revenueSeries,
  servicePerformance,
} from "@/lib/services/analytics";
import { lowStockItems } from "@/lib/services/inventory";
import { PERMISSIONS } from "@/lib/rbac";
import { hasPermission, requireFirmId, requirePermission } from "@/lib/session";
import { humanize } from "@/lib/utils";
import {
  branchOptions,
  dateRangeFrom,
  param,
  scopedBranchId,
  type SearchParams,
} from "@/lib/queries/filters";

export const metadata = { title: "Reports" };

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const user = await requirePermission(PERMISSIONS.REPORT_VIEW);

  const branchId = scopedBranchId(user, params);
  const firmId = requireFirmId(user);
  const range = dateRangeFrom(params) ?? {
    from: new Date(Date.now() - 29 * 24 * 60 * 60 * 1000),
    to: new Date(),
  };
  const tab = param(params, "tab") ?? "sales";
  const filters = { firmId, branchId, range };

  const canSales = hasPermission(user, PERMISSIONS.REPORT_SALES);
  const canOps = hasPermission(user, PERMISSIONS.REPORT_OPERATIONS);
  const canFinance = hasPermission(user, PERMISSIONS.REPORT_FINANCE);
  const canExport = hasPermission(user, PERMISSIONS.REPORT_EXPORT);
  const canInventory = hasPermission(user, PERMISSIONS.INVENTORY_VIEW);
  const canGarments = hasPermission(user, PERMISSIONS.TRACKING_VIEW);

  const [
    series,
    services,
    branchStats,
    operations,
    delivery,
    finance,
    lowStock,
    stockMovement,
    purchaseHistory,
    branches,
    garments,
  ] = await Promise.all([
    canSales ? revenueSeries(filters) : Promise.resolve([]),
    canSales ? servicePerformance(filters) : Promise.resolve([]),
    hasPermission(user, PERMISSIONS.DASHBOARD_VIEW_ALL_BRANCHES)
      ? branchPerformance(firmId, range)
      : Promise.resolve([]),
    canOps ? operationsMetrics(filters) : Promise.resolve(null),
    canOps ? deliveryMetrics(filters) : Promise.resolve(null),
    canFinance ? financeMetrics(filters) : Promise.resolve(null),
    canInventory ? lowStockItems(firmId, branchId) : Promise.resolve([]),
    canInventory
      ? prisma.inventoryTransaction.groupBy({
          by: ["type"],
          where: {
            branch: { firmId },
            ...(branchId ? { branchId } : {}),
            createdAt: { gte: range.from, lte: range.to },
          },
          _sum: { quantity: true },
          _count: { _all: true },
        })
      : Promise.resolve([]),
    canInventory
      ? prisma.purchaseOrder.findMany({
          where: {
            firmId,
            ...(branchId ? { branchId } : {}),
            orderDate: { gte: range.from, lte: range.to },
          },
          orderBy: { orderDate: "desc" },
          take: 25,
          include: { supplier: { select: { name: true } } },
        })
      : Promise.resolve([]),
    branchOptions(user),
    canGarments ? garmentReport(filters, firmId) : Promise.resolve(null),
  ]);

  const exportQuery = new URLSearchParams({
    from: range.from.toISOString().slice(0, 10),
    to: range.to.toISOString().slice(0, 10),
    ...(branchId ? { branch: branchId } : {}),
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Reports"
        description={`${formatDate(range.from)} – ${formatDate(range.to)}`}
        actions={
          canExport ? (
            <Button asChild variant="outline">
              <a href={`/api/reports/export?report=${tab}&${exportQuery.toString()}`}>
                <Download /> Export CSV
              </a>
            </Button>
          ) : null
        }
      />

      <FilterBar
        showSearch={false}
        showDateRange
        filters={
          branches.length > 1
            ? [{ name: "branch", label: "Branch", options: branches }]
            : []
        }
      />

      <Tabs value={tab}>
        <TabsList className="flex-wrap">
          {canSales ? (
            <TabsTrigger value="sales" asChild>
              <Link href="/reports?tab=sales">Sales</Link>
            </TabsTrigger>
          ) : null}
          {canOps ? (
            <TabsTrigger value="operations" asChild>
              <Link href="/reports?tab=operations">Operations</Link>
            </TabsTrigger>
          ) : null}
          {canOps ? (
            <TabsTrigger value="delivery" asChild>
              <Link href="/reports?tab=delivery">Delivery</Link>
            </TabsTrigger>
          ) : null}
          {canInventory ? (
            <TabsTrigger value="inventory" asChild>
              <Link href="/reports?tab=inventory">Inventory</Link>
            </TabsTrigger>
          ) : null}
          {canGarments ? (
            <TabsTrigger value="garments" asChild>
              <Link href="/reports?tab=garments">Garments</Link>
            </TabsTrigger>
          ) : null}
          {canFinance ? (
            <TabsTrigger value="finance" asChild>
              <Link href="/reports?tab=finance">Finance</Link>
            </TabsTrigger>
          ) : null}
        </TabsList>

        {canSales ? (
          <TabsContent value="sales" className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <StatCard
                label="Revenue"
                value={formatCurrency(
                  series.reduce((sum, point) => sum + point.revenue, 0),
                )}
                tone="success"
              />
              <StatCard
                label="Orders"
                value={series.reduce((sum, point) => sum + point.orders, 0)}
              />
              <StatCard
                label="Average order value"
                value={formatCurrency(
                  series.reduce((sum, point) => sum + point.orders, 0) > 0
                    ? series.reduce((sum, point) => sum + point.revenue, 0) /
                        series.reduce((sum, point) => sum + point.orders, 0)
                    : 0,
                )}
              />
            </div>

            <RevenueChart data={series} />

            <CategoryBarChart
              title="Sales by service"
              description="Revenue contributed by each service line"
              humanizeNames={false}
              data={services.map((service) => ({
                name: service.name,
                value: service.revenue,
                secondary: { label: "Orders", value: String(service.orders) },
              }))}
              valueLabel="Revenue"
              format="currency"
            />

            {branchStats.length > 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Sales by branch</CardTitle>
                </CardHeader>
                <CardContent className="overflow-x-auto p-0">
                  <table className="w-full min-w-[420px] text-sm">
                    <thead>
                      <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="px-4 py-2.5 text-left">Branch</th>
                        <th className="px-4 py-2.5 text-right">Orders</th>
                        <th className="px-4 py-2.5 text-right">Revenue</th>
                        <th className="px-4 py-2.5 text-right">Outstanding</th>
                      </tr>
                    </thead>
                    <tbody>
                      {branchStats.map((branch) => (
                        <tr
                          key={branch.branchId}
                          className="border-b border-border last:border-0"
                        >
                          <td className="px-4 py-2.5 font-medium">{branch.name}</td>
                          <td className="px-4 py-2.5 text-right numeric">
                            {branch.orders}
                          </td>
                          <td className="px-4 py-2.5 text-right numeric">
                            {formatCurrency(branch.revenue)}
                          </td>
                          <td className="px-4 py-2.5 text-right numeric">
                            {formatCurrency(branch.outstanding)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            ) : null}
          </TabsContent>
        ) : null}

        {canOps && operations ? (
          <TabsContent value="operations" className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard label="Orders received" value={operations.ordersReceived} />
              <StatCard
                label="Completed"
                value={operations.ordersCompleted}
                tone="success"
              />
              <StatCard label="Still open" value={operations.ordersPending} />
              <StatCard
                label="Delayed"
                value={operations.ordersDelayed}
                tone={operations.ordersDelayed > 0 ? "danger" : "default"}
              />
              <StatCard
                label="Average turnaround"
                value={`${operations.averageTurnaroundHours} hrs`}
              />
              <StatCard
                label="Rewash rate"
                value={`${operations.rewashPercentage}%`}
                tone={operations.rewashPercentage > 5 ? "warning" : "default"}
              />
              <StatCard
                label="QC failure rate"
                value={`${operations.qcFailureRate}%`}
                tone={operations.qcFailureRate > 5 ? "warning" : "default"}
              />
              <StatCard
                label="Missing / damaged garments"
                value={operations.missingGarments}
                tone={operations.missingGarments > 0 ? "danger" : "default"}
                hint={`out of ${operations.totalGarments} tracked`}
              />
            </div>
          </TabsContent>
        ) : null}

        {canOps && delivery ? (
          <TabsContent value="delivery" className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard label="Scheduled" value={delivery.scheduled} />
              <StatCard label="Delivered" value={delivery.delivered} tone="success" />
              <StatCard
                label="Failed / rescheduled"
                value={delivery.failed}
                tone={delivery.failed > 0 ? "danger" : "default"}
              />
              <StatCard
                label="On-time delivery"
                value={`${delivery.onTimePercentage}%`}
                tone={delivery.onTimePercentage >= 90 ? "success" : "warning"}
              />
            </div>

            <CategoryBarChart
              title="Driver performance"
              description="Deliveries completed per driver"
              humanizeNames={false}
              color="var(--chart-3)"
              data={delivery.driverPerformance.map((driver) => ({
                name: driver.name,
                value: driver.delivered,
                secondary: {
                  label: "Collected",
                  value: formatCurrency(driver.collected),
                },
              }))}
              valueLabel="Delivered"
            />

            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Amount collected on delivery</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold numeric">
                  {formatCurrency(delivery.amountCollected)}
                </p>
              </CardContent>
            </Card>
          </TabsContent>
        ) : null}

        {canInventory ? (
          <TabsContent value="inventory" className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <StatCard
                label="Items below minimum"
                value={lowStock.length}
                tone={lowStock.length > 0 ? "danger" : "success"}
              />
              <StatCard
                label="Movements in period"
                value={stockMovement.reduce((sum, row) => sum + row._count._all, 0)}
              />
            </div>

            <CategoryBarChart
              title="Stock movement"
              description="Quantity moved by movement type"
              color="var(--chart-2)"
              data={stockMovement.map((row) => ({
                name: row.type,
                value: Math.abs(num(row._sum.quantity)),
                secondary: { label: "Entries", value: String(row._count._all) },
              }))}
              valueLabel="Quantity"
            />

            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Low stock</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto p-0">
                {lowStock.length === 0 ? (
                  <p className="p-6 text-center text-sm text-muted-foreground">
                    Every item is above its reorder level.
                  </p>
                ) : (
                  <table className="w-full min-w-[420px] text-sm">
                    <thead>
                      <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="px-4 py-2.5 text-left">Item</th>
                        <th className="px-4 py-2.5 text-left">Branch</th>
                        <th className="px-4 py-2.5 text-right">On hand</th>
                        <th className="px-4 py-2.5 text-right">Minimum</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lowStock.map((entry) => (
                        <tr
                          key={`${entry.itemId}-${entry.branchId}`}
                          className="border-b border-border last:border-0"
                        >
                          <td className="px-4 py-2.5">
                            <p className="font-medium">{entry.name}</p>
                            <p className="font-mono text-xs text-muted-foreground">
                              {entry.sku}
                            </p>
                          </td>
                          <td className="px-4 py-2.5 text-muted-foreground">
                            {entry.branchName}
                          </td>
                          <td className="px-4 py-2.5 text-right numeric text-destructive">
                            {entry.quantity} {entry.unit}
                          </td>
                          <td className="px-4 py-2.5 text-right numeric text-muted-foreground">
                            {entry.minStockLevel} {entry.unit}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Purchase history</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto p-0">
                {purchaseHistory.length === 0 ? (
                  <p className="p-6 text-center text-sm text-muted-foreground">
                    No purchase orders in this period.
                  </p>
                ) : (
                  <table className="w-full min-w-[420px] text-sm">
                    <thead>
                      <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="px-4 py-2.5 text-left">PO</th>
                        <th className="px-4 py-2.5 text-left">Supplier</th>
                        <th className="px-4 py-2.5 text-left">Date</th>
                        <th className="px-4 py-2.5 text-left">Status</th>
                        <th className="px-4 py-2.5 text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {purchaseHistory.map((po) => (
                        <tr key={po.id} className="border-b border-border last:border-0">
                          <td className="px-4 py-2.5">
                            <Link
                              href={`/purchases/${po.id}`}
                              className="font-mono text-primary hover:underline"
                            >
                              {po.poNumber}
                            </Link>
                          </td>
                          <td className="px-4 py-2.5">{po.supplier.name}</td>
                          <td className="px-4 py-2.5 text-muted-foreground">
                            {formatDate(po.orderDate)}
                          </td>
                          <td className="px-4 py-2.5">
                            <StatusBadge status={po.status} />
                          </td>
                          <td className="px-4 py-2.5 text-right numeric">
                            {formatCurrency(po.total)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        ) : null}

        {canFinance && finance ? (
          <TabsContent value="finance" className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard
                label="Revenue"
                value={formatCurrency(finance.revenue)}
                tone="success"
              />
              <StatCard label="Collected" value={formatCurrency(finance.collected)} />
              <StatCard
                label="Outstanding"
                value={formatCurrency(finance.outstanding)}
                tone={finance.outstanding > 0 ? "warning" : "default"}
              />
              <StatCard label="Refunds" value={formatCurrency(finance.refunds)} />
              <StatCard label="Expenses" value={formatCurrency(finance.expenses)} />
              <StatCard
                label="Supplier outstanding"
                value={formatCurrency(finance.supplierOutstanding)}
                tone={finance.supplierOutstanding > 0 ? "warning" : "default"}
              />
              <StatCard
                label="Profit"
                value={formatCurrency(finance.profit)}
                tone={finance.profit >= 0 ? "success" : "danger"}
                hint="Revenue less expenses and refunds"
              />
            </div>

            <CategoryBarChart
              title="Collection by method"
              description="How customers actually paid"
              data={finance.collectionByMethod.map((row) => ({
                name: row.method,
                value: row.amount,
              }))}
              valueLabel="Collected"
              format="currency"
            />
          </TabsContent>
        ) : null}
      </Tabs>
    </div>
  );
}
