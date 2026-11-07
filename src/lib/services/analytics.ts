import "server-only";
import { prisma } from "@/lib/prisma";
import { num, round2 } from "@/lib/money";
import { hoursBetween, todayRange, type DateRange } from "@/lib/dates";
import { PROCESSING_ORDER_STATUSES } from "@/lib/workflow";
import type { Prisma } from "@/generated/prisma/client";
import { GARMENT_CATEGORIES, categoryLabel } from "@/lib/garment-categories";
import { MISMATCH_LABELS, detectMismatches } from "@/lib/services/garment-tracking";
import { STAGE_LABELS } from "@/lib/workflow";

export interface DashboardFilters {
  firmId: string;
  branchId?: string;
  range?: DateRange;
  serviceId?: string;
  status?: string;
}

function orderWhere(filters: DashboardFilters): Prisma.OrderWhereInput {
  return {
    firmId: filters.firmId,
    ...(filters.branchId ? { branchId: filters.branchId } : {}),
    ...(filters.serviceId ? { items: { some: { serviceId: filters.serviceId } } } : {}),
    ...(filters.status ? { status: filters.status as never } : {}),
    ...(filters.range
      ? { placedAt: { gte: filters.range.from, lte: filters.range.to } }
      : {}),
  };
}

export interface DashboardMetrics {
  todayOrders: number;
  received: number;
  processing: number;
  ready: number;
  outForDelivery: number;
  completed: number;
  delayed: number;
  todayRevenue: number;
  pendingPayments: number;
  lowStock: number;
  openComplaints: number;
  garmentsInProcess: number;
  rangeOrders: number;
  rangeRevenue: number;
}

/** Headline counters for the dashboard tiles. */
export async function dashboardMetrics(
  filters: DashboardFilters,
): Promise<DashboardMetrics> {
  const today = todayRange();
  const branchFilter = { firmId: filters.firmId, ...(filters.branchId ? { branchId: filters.branchId } : {}) };
  const base = orderWhere(filters);
  const now = new Date();

  const [
    todayOrders,
    statusGroups,
    delayed,
    todayRevenue,
    pendingPayments,
    lowStockRows,
    openComplaints,
    garmentsInProcess,
    rangeAggregate,
  ] = await Promise.all([
    prisma.order.count({
      where: { ...branchFilter, placedAt: { gte: today.from, lte: today.to } },
    }),
    prisma.order.groupBy({
      by: ["status"],
      where: base,
      _count: { _all: true },
    }),
    prisma.order.count({
      where: {
        ...base,
        expectedDeliveryAt: { lt: now },
        status: { notIn: ["DELIVERED", "CANCELLED", "REFUNDED"] },
      },
    }),
    prisma.payment.aggregate({
      where: {
        ...branchFilter,
        state: "CAPTURED",
        paidAt: { gte: today.from, lte: today.to },
      },
      _sum: { amount: true },
    }),
    prisma.order.aggregate({
      where: {
        ...branchFilter,
        status: { notIn: ["CANCELLED", "REFUNDED"] },
        outstandingAmount: { gt: 0 },
      },
      _sum: { outstandingAmount: true },
    }),
    prisma.inventoryStock.findMany({
      where: {
        ...(filters.branchId ? { branchId: filters.branchId } : {}),
        item: { firmId: filters.firmId, isActive: true },
      },
      select: { quantity: true, item: { select: { minStockLevel: true } } },
    }),
    prisma.complaint.count({
      where: {
        ...branchFilter,
        status: { in: ["OPEN", "UNDER_INVESTIGATION", "AWAITING_CUSTOMER"] },
      },
    }),
    prisma.garment.count({
      where: {
        ...branchFilter,
        status: {
          notIn: ["DELIVERED", "LOST", "RETURNED", "READY", "PACKED"],
        },
      },
    }),
    prisma.order.aggregate({
      where: base,
      _sum: { totalAmount: true },
      _count: { _all: true },
    }),
  ]);

  const byStatus = new Map(statusGroups.map((row) => [row.status, row._count._all]));
  const sumOf = (statuses: string[]) =>
    statuses.reduce((sum, status) => sum + (byStatus.get(status as never) ?? 0), 0);

  return {
    todayOrders,
    received: byStatus.get("RECEIVED") ?? 0,
    processing: sumOf(PROCESSING_ORDER_STATUSES),
    ready: byStatus.get("READY") ?? 0,
    outForDelivery: byStatus.get("OUT_FOR_DELIVERY") ?? 0,
    completed: sumOf(["DELIVERED", "PARTIALLY_DELIVERED"]),
    delayed,
    todayRevenue: num(todayRevenue._sum.amount),
    pendingPayments: num(pendingPayments._sum.outstandingAmount),
    lowStock: lowStockRows.filter(
      (row) => num(row.quantity) <= num(row.item.minStockLevel),
    ).length,
    openComplaints,
    garmentsInProcess,
    rangeOrders: rangeAggregate._count._all,
    rangeRevenue: num(rangeAggregate._sum.totalAmount),
  };
}

export interface TimeSeriesPoint {
  date: string;
  orders: number;
  revenue: number;
}

/**
 * Daily order volume and revenue. Uses a grouped query rather than one query
 * per day so the chart stays cheap over long ranges.
 */
export async function revenueSeries(
  filters: DashboardFilters,
  days = 30,
): Promise<TimeSeriesPoint[]> {
  const to = filters.range?.to ?? new Date();
  const from =
    filters.range?.from ?? new Date(to.getTime() - (days - 1) * 24 * 60 * 60 * 1000);

  const orders = await prisma.order.findMany({
    where: {
      firmId: filters.firmId,
      ...(filters.branchId ? { branchId: filters.branchId } : {}),
      ...(filters.serviceId
        ? { items: { some: { serviceId: filters.serviceId } } }
        : {}),
      status: { notIn: ["CANCELLED"] },
      placedAt: { gte: from, lte: to },
    },
    select: { placedAt: true, totalAmount: true },
  });

  const buckets = new Map<string, { orders: number; revenue: number }>();

  const cursor = new Date(from);
  cursor.setHours(0, 0, 0, 0);
  while (cursor <= to) {
    buckets.set(cursor.toISOString().slice(0, 10), { orders: 0, revenue: 0 });
    cursor.setDate(cursor.getDate() + 1);
  }

  for (const order of orders) {
    const key = order.placedAt.toISOString().slice(0, 10);
    const bucket = buckets.get(key);
    if (!bucket) continue;
    bucket.orders += 1;
    bucket.revenue = round2(bucket.revenue + num(order.totalAmount));
  }

  return [...buckets.entries()].map(([date, value]) => ({ date, ...value }));
}

export interface StatusSlice {
  name: string;
  value: number;
}

export async function orderStatusBreakdown(
  filters: DashboardFilters,
): Promise<StatusSlice[]> {
  const groups = await prisma.order.groupBy({
    by: ["status"],
    where: orderWhere(filters),
    _count: { _all: true },
  });

  return groups
    .filter((group) => group._count._all > 0)
    .map((group) => ({ name: group.status, value: group._count._all }))
    .sort((a, b) => b.value - a.value);
}

export interface ServicePerformance {
  name: string;
  orders: number;
  pieces: number;
  revenue: number;
}

export async function servicePerformance(
  filters: DashboardFilters,
): Promise<ServicePerformance[]> {
  const items = await prisma.orderItem.findMany({
    where: {
      order: orderWhere(filters),
    },
    select: {
      quantity: true,
      lineTotal: true,
      orderId: true,
      service: { select: { id: true, name: true } },
    },
  });

  const byService = new Map<
    string,
    { name: string; orders: Set<string>; pieces: number; revenue: number }
  >();

  for (const item of items) {
    const entry = byService.get(item.service.id) ?? {
      name: item.service.name,
      orders: new Set<string>(),
      pieces: 0,
      revenue: 0,
    };
    entry.orders.add(item.orderId);
    entry.pieces += item.quantity;
    entry.revenue = round2(entry.revenue + num(item.lineTotal));
    byService.set(item.service.id, entry);
  }

  return [...byService.values()]
    .map((entry) => ({
      name: entry.name,
      orders: entry.orders.size,
      pieces: entry.pieces,
      revenue: entry.revenue,
    }))
    .sort((a, b) => b.revenue - a.revenue);
}

export interface BranchPerformance {
  branchId: string;
  name: string;
  orders: number;
  revenue: number;
  outstanding: number;
  delayed: number;
}

export async function branchPerformance(
  firmId: string,
  range?: DateRange,
): Promise<BranchPerformance[]> {
  const now = new Date();
  const branches = await prisma.branch.findMany({
    where: { firmId, isActive: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const results = await Promise.all(
    branches.map(async (branch) => {
      const where: Prisma.OrderWhereInput = {
        branchId: branch.id,
        ...(range ? { placedAt: { gte: range.from, lte: range.to } } : {}),
      };

      const [aggregate, delayed] = await Promise.all([
        prisma.order.aggregate({
          where: { ...where, status: { not: "CANCELLED" } },
          _sum: { totalAmount: true, outstandingAmount: true },
          _count: { _all: true },
        }),
        prisma.order.count({
          where: {
            ...where,
            expectedDeliveryAt: { lt: now },
            status: { notIn: ["DELIVERED", "CANCELLED", "REFUNDED"] },
          },
        }),
      ]);

      return {
        branchId: branch.id,
        name: branch.name,
        orders: aggregate._count._all,
        revenue: num(aggregate._sum.totalAmount),
        outstanding: num(aggregate._sum.outstandingAmount),
        delayed,
      };
    }),
  );

  return results.sort((a, b) => b.revenue - a.revenue);
}

export interface OperationsMetrics {
  ordersReceived: number;
  ordersCompleted: number;
  ordersPending: number;
  ordersDelayed: number;
  averageTurnaroundHours: number;
  rewashPercentage: number;
  qcFailureRate: number;
  missingGarments: number;
  totalGarments: number;
}

export async function operationsMetrics(
  filters: DashboardFilters,
): Promise<OperationsMetrics> {
  const base = orderWhere(filters);
  const now = new Date();
  const garmentWhere = {
    firmId: filters.firmId,
    ...(filters.branchId ? { branchId: filters.branchId } : {}),
    ...(filters.range
      ? { createdAt: { gte: filters.range.from, lte: filters.range.to } }
      : {}),
  };

  const [
    ordersReceived,
    completedOrders,
    ordersPending,
    ordersDelayed,
    totalGarments,
    rewashed,
    qcFailures,
    qcChecks,
    missing,
  ] = await Promise.all([
    prisma.order.count({ where: base }),
    prisma.order.findMany({
      where: { ...base, status: "DELIVERED", deliveredAt: { not: null } },
      select: { placedAt: true, deliveredAt: true },
    }),
    prisma.order.count({
      where: { ...base, status: { notIn: ["DELIVERED", "CANCELLED", "REFUNDED"] } },
    }),
    prisma.order.count({
      where: {
        ...base,
        expectedDeliveryAt: { lt: now },
        status: { notIn: ["DELIVERED", "CANCELLED", "REFUNDED"] },
      },
    }),
    prisma.garment.count({ where: garmentWhere }),
    prisma.garment.count({ where: { ...garmentWhere, rewashCount: { gt: 0 } } }),
    prisma.processingTask.count({
      where: {
        stage: "QUALITY_CHECK",
        status: "FAILED",
        branch: { firmId: filters.firmId },
        ...(filters.branchId ? { branchId: filters.branchId } : {}),
        ...(filters.range
          ? { updatedAt: { gte: filters.range.from, lte: filters.range.to } }
          : {}),
      },
    }),
    prisma.processingTask.count({
      where: {
        stage: "QUALITY_CHECK",
        status: { in: ["PASSED", "FAILED"] },
        branch: { firmId: filters.firmId },
        ...(filters.branchId ? { branchId: filters.branchId } : {}),
        ...(filters.range
          ? { updatedAt: { gte: filters.range.from, lte: filters.range.to } }
          : {}),
      },
    }),
    prisma.garment.count({
      where: { ...garmentWhere, status: { in: ["LOST", "DAMAGED"] } },
    }),
  ]);

  const turnaround = completedOrders.length
    ? completedOrders.reduce(
        (sum, order) => sum + hoursBetween(order.placedAt, order.deliveredAt!),
        0,
      ) / completedOrders.length
    : 0;

  return {
    ordersReceived,
    ordersCompleted: completedOrders.length,
    ordersPending,
    ordersDelayed,
    averageTurnaroundHours: round2(turnaround),
    rewashPercentage: totalGarments ? round2((rewashed / totalGarments) * 100) : 0,
    qcFailureRate: qcChecks ? round2((qcFailures / qcChecks) * 100) : 0,
    missingGarments: missing,
    totalGarments,
  };
}

export interface DeliveryMetrics {
  scheduled: number;
  delivered: number;
  failed: number;
  onTimePercentage: number;
  amountCollected: number;
  driverPerformance: {
    driverId: string;
    name: string;
    delivered: number;
    failed: number;
    collected: number;
  }[];
}

export async function deliveryMetrics(
  filters: DashboardFilters,
): Promise<DeliveryMetrics> {
  const where: Prisma.DeliveryWhereInput = {
    firmId: filters.firmId,
    ...(filters.branchId ? { branchId: filters.branchId } : {}),
    ...(filters.range
      ? { scheduledAt: { gte: filters.range.from, lte: filters.range.to } }
      : {}),
  };

  const deliveries = await prisma.delivery.findMany({
    where,
    include: { driver: { include: { user: { select: { name: true } } } } },
  });

  const delivered = deliveries.filter((entry) => entry.status === "DELIVERED");
  const failed = deliveries.filter((entry) =>
    ["FAILED", "RESCHEDULED"].includes(entry.status),
  );
  const onTime = delivered.filter(
    (entry) => entry.deliveredAt && entry.deliveredAt <= entry.scheduledAt,
  );

  const byDriver = new Map<
    string,
    { name: string; delivered: number; failed: number; collected: number }
  >();

  for (const entry of deliveries) {
    if (!entry.driverId || !entry.driver) continue;
    const record = byDriver.get(entry.driverId) ?? {
      name: entry.driver.user.name,
      delivered: 0,
      failed: 0,
      collected: 0,
    };
    if (entry.status === "DELIVERED") record.delivered += 1;
    if (["FAILED", "RESCHEDULED"].includes(entry.status)) record.failed += 1;
    record.collected = round2(record.collected + num(entry.amountCollected));
    byDriver.set(entry.driverId, record);
  }

  return {
    scheduled: deliveries.length,
    delivered: delivered.length,
    failed: failed.length,
    onTimePercentage: delivered.length
      ? round2((onTime.length / delivered.length) * 100)
      : 0,
    amountCollected: round2(
      deliveries.reduce((sum, entry) => sum + num(entry.amountCollected), 0),
    ),
    driverPerformance: [...byDriver.entries()]
      .map(([driverId, value]) => ({ driverId, ...value }))
      .sort((a, b) => b.delivered - a.delivered),
  };
}

export interface FinanceMetrics {
  revenue: number;
  collected: number;
  outstanding: number;
  refunds: number;
  expenses: number;
  supplierOutstanding: number;
  profit: number;
  collectionByMethod: { method: string; amount: number }[];
}

export async function financeMetrics(
  filters: DashboardFilters,
): Promise<FinanceMetrics> {
  const branchFilter = { firmId: filters.firmId, ...(filters.branchId ? { branchId: filters.branchId } : {}) };
  const rangeFilter = filters.range
    ? { gte: filters.range.from, lte: filters.range.to }
    : undefined;

  const [revenue, payments, outstanding, refunds, expenses, payables] = await Promise.all([
    prisma.order.aggregate({
      where: {
        ...branchFilter,
        status: { notIn: ["CANCELLED", "REFUNDED"] },
        ...(rangeFilter ? { placedAt: rangeFilter } : {}),
      },
      _sum: { totalAmount: true },
    }),
    prisma.payment.groupBy({
      by: ["method"],
      where: {
        ...branchFilter,
        state: "CAPTURED",
        ...(rangeFilter ? { paidAt: rangeFilter } : {}),
      },
      _sum: { amount: true },
    }),
    prisma.order.aggregate({
      where: {
        ...branchFilter,
        status: { notIn: ["CANCELLED", "REFUNDED"] },
        outstandingAmount: { gt: 0 },
      },
      _sum: { outstandingAmount: true },
    }),
    prisma.refund.aggregate({
      where: {
        status: "PROCESSED",
        order: { firmId: filters.firmId },
        ...(rangeFilter ? { processedAt: rangeFilter } : {}),
      },
      _sum: { amount: true },
    }),
    prisma.expense.aggregate({
      where: {
        ...branchFilter,
        status: { in: ["APPROVED", "PAID"] },
        ...(rangeFilter ? { expenseDate: rangeFilter } : {}),
      },
      _sum: { amount: true },
    }),
    prisma.purchaseInvoice.findMany({
      where: {
        status: { in: ["UNPAID", "PARTIALLY_PAID", "OVERDUE"] },
        supplier: { firmId: filters.firmId },
      },
      select: { total: true, amountPaid: true },
    }),
  ]);

  const collected = round2(
    payments.reduce((sum, row) => sum + num(row._sum.amount), 0),
  );
  const revenueTotal = num(revenue._sum.totalAmount);
  const expenseTotal = num(expenses._sum.amount);
  const refundTotal = num(refunds._sum.amount);

  return {
    revenue: revenueTotal,
    collected,
    outstanding: num(outstanding._sum.outstandingAmount),
    refunds: refundTotal,
    expenses: expenseTotal,
    supplierOutstanding: round2(
      payables.reduce(
        (sum, invoice) => sum + num(invoice.total) - num(invoice.amountPaid),
        0,
      ),
    ),
    profit: round2(revenueTotal - expenseTotal - refundTotal),
    collectionByMethod: payments
      .map((row) => ({ method: row.method, amount: num(row._sum.amount) }))
      .sort((a, b) => b.amount - a.amount),
  };
}

/** Stage-by-stage queue depth, for the dashboard's processing chart. */
export async function stagePipeline(firmId: string, branchId?: string) {
  const groups = await prisma.processingTask.groupBy({
    by: ["stage", "status"],
    where: {
      branch: { firmId },
      ...(branchId ? { branchId } : {}),
      status: { in: ["PENDING", "IN_PROGRESS"] },
    },
    _count: { _all: true },
  });

  const byStage = new Map<string, { pending: number; inProgress: number }>();
  for (const row of groups) {
    const entry = byStage.get(row.stage) ?? { pending: 0, inProgress: 0 };
    if (row.status === "PENDING") entry.pending += row._count._all;
    else entry.inProgress += row._count._all;
    byStage.set(row.stage, entry);
  }

  return [...byStage.entries()].map(([stage, counts]) => ({ stage, ...counts }));
}

export interface GarmentReport {
  totalOnFloor: number;
  delivered: number;
  categories: Array<{
    category: string;
    label: string;
    emoji: string;
    onFloor: number;
    ready: number;
    delivered: number;
    issues: number;
  }>;
  mismatches: Array<{ kind: string; label: string; count: number }>;
  missing: Array<{
    garmentCode: string;
    categoryLabel: string;
    orderNumber: string;
    customerName: string;
    detail: string;
    reportedAt: Date | null;
  }>;
  scanned: { total: number; clean: number; problems: number };
  busiestStations: Array<{ stage: string; label: string; scans: number }>;
}

/**
 * The garment side of reporting: what is in the building by category, how the
 * scanning is actually going, and every piece currently unaccounted for. All of
 * it derived from the same engine the mismatch centre uses, so a report and the
 * screen it summarises can never tell different stories.
 */
export async function garmentReport(
  filters: DashboardFilters,
  firmId: string,
): Promise<GarmentReport> {
  const branchIds = filters.branchId ? [filters.branchId] : null;
  const branchWhere = filters.branchId ? { branchId: filters.branchId } : {};
  const window = filters.range
    ? { gte: filters.range.from, lte: filters.range.to }
    : undefined;

  const [onFloor, ready, delivered, findings, scans, missingRows] = await Promise.all([
    prisma.garment.groupBy({
      by: ["trackingCategory"],
      where: { firmId, ...branchWhere, status: { notIn: ["DELIVERED", "RETURNED"] } },
      _count: { _all: true },
    }),
    prisma.garment.groupBy({
      by: ["trackingCategory"],
      where: { firmId, ...branchWhere, status: "READY" },
      _count: { _all: true },
    }),
    prisma.garment.groupBy({
      by: ["trackingCategory"],
      where: {
        firmId,
        ...branchWhere,
        status: "DELIVERED",
        ...(window ? { deliveredAt: window } : {}),
      },
      _count: { _all: true },
    }),
    detectMismatches({ firmId, branchIds }),
    prisma.garmentScan.groupBy({
      by: ["stage", "outcome"],
      where: { garment: { firmId }, ...branchWhere, ...(window ? { scannedAt: window } : {}) },
      _count: { _all: true },
    }),
    prisma.garmentException.findMany({
      where: { branch: { firmId }, ...branchWhere, type: "MISSING", status: "OPEN" },
      orderBy: { reportedAt: "desc" },
      take: 25,
      select: {
        detail: true,
        reportedAt: true,
        garment: {
          select: {
            garmentCode: true,
            trackingCategory: true,
            order: { select: { orderNumber: true, customerName: true } },
          },
        },
      },
    }),
  ]);

  const floorBy = new Map(onFloor.map((row) => [row.trackingCategory, row._count._all]));
  const readyBy = new Map(ready.map((row) => [row.trackingCategory, row._count._all]));
  const deliveredBy = new Map(delivered.map((row) => [row.trackingCategory, row._count._all]));

  const issuesBy = new Map<string, number>();
  const kindCounts = new Map<string, number>();
  for (const finding of findings) {
    issuesBy.set(finding.category, (issuesBy.get(finding.category) ?? 0) + 1);
    kindCounts.set(finding.kind, (kindCounts.get(finding.kind) ?? 0) + 1);
  }

  const byStation = new Map<string, number>();
  let cleanScans = 0;
  let problemScans = 0;
  for (const row of scans) {
    byStation.set(row.stage, (byStation.get(row.stage) ?? 0) + row._count._all);
    if (row.outcome === "MATCH") cleanScans += row._count._all;
    else problemScans += row._count._all;
  }

  return {
    totalOnFloor: [...floorBy.values()].reduce((sum, count) => sum + count, 0),
    delivered: [...deliveredBy.values()].reduce((sum, count) => sum + count, 0),
    categories: GARMENT_CATEGORIES.map((meta) => ({
      category: meta.value,
      label: meta.label,
      emoji: meta.emoji,
      onFloor: floorBy.get(meta.value) ?? 0,
      ready: readyBy.get(meta.value) ?? 0,
      delivered: deliveredBy.get(meta.value) ?? 0,
      issues: issuesBy.get(meta.value) ?? 0,
    })).filter((row) => row.onFloor + row.delivered > 0),
    mismatches: (Object.keys(MISMATCH_LABELS) as Array<keyof typeof MISMATCH_LABELS>).map(
      (kind) => ({
        kind,
        label: MISMATCH_LABELS[kind],
        count: kindCounts.get(kind) ?? 0,
      }),
    ),
    missing: missingRows.map((row) => ({
      garmentCode: row.garment.garmentCode,
      categoryLabel: categoryLabel(row.garment.trackingCategory),
      orderNumber: row.garment.order.orderNumber,
      customerName: row.garment.order.customerName,
      detail: row.detail ?? "Reported missing",
      reportedAt: row.reportedAt,
    })),
    scanned: {
      total: cleanScans + problemScans,
      clean: cleanScans,
      problems: problemScans,
    },
    busiestStations: [...byStation.entries()]
      .map(([stage, count]) => ({
        stage,
        label: STAGE_LABELS[stage as keyof typeof STAGE_LABELS] ?? stage,
        scans: count,
      }))
      .sort((a, b) => b.scans - a.scans),
  };
}
