import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { AuthorizationError, getCurrentUser, hasPermission, requireFirmId } from "@/lib/session";
import { isGlobalRole, PERMISSIONS } from "@/lib/rbac";
import { RATE_LIMITS, rateLimit } from "@/lib/rate-limit";
import { num, round2 } from "@/lib/money";
import { resolveDateRange } from "@/lib/dates";

/** RFC 4180 quoting, with a guard against spreadsheet formula injection. */
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (/[",\n\r]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
}

/**
 * CSV export for the reports module. Each report re-checks its own permission
 * and is scoped to the branches the caller may see.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!hasPermission(user, PERMISSIONS.REPORT_EXPORT)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let firmId: string;
  try {
    firmId = requireFirmId(user);
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    throw error;
  }

  const limit = rateLimit(
    `report:${user.id}`,
    RATE_LIMITS.REPORT.limit,
    RATE_LIMITS.REPORT.windowMs,
  );
  if (!limit.success) {
    return NextResponse.json({ error: "Too many exports" }, { status: 429 });
  }

  const { searchParams } = new URL(request.url);
  const report = searchParams.get("report") ?? "sales";

  const range =
    resolveDateRange(undefined, searchParams.get("from") ?? undefined, searchParams.get("to") ?? undefined) ??
    {
      from: new Date(Date.now() - 29 * 24 * 60 * 60 * 1000),
      to: new Date(),
    };

  const requestedBranch = searchParams.get("branch");
  const branchId = isGlobalRole(user.role)
    ? (requestedBranch ?? undefined)
    : (user.branchId ?? "__none__");
  const branchFilter = branchId ? { branchId } : {};

  let filename = `${report}-report.csv`;
  let csv = "";

  switch (report) {
    case "operations": {
      if (!hasPermission(user, PERMISSIONS.REPORT_OPERATIONS)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      const orders = await prisma.order.findMany({
        where: { firmId, ...branchFilter, placedAt: { gte: range.from, lte: range.to } },
        orderBy: { placedAt: "asc" },
        include: { branch: { select: { name: true } } },
      });
      csv = toCsv(
        [
          "Order",
          "Branch",
          "Customer",
          "Placed",
          "Expected",
          "Delivered",
          "Status",
          "Pieces",
          "Turnaround hours",
        ],
        orders.map((order) => [
          order.orderNumber,
          order.branch.name,
          order.customerName,
          order.placedAt.toISOString(),
          order.expectedDeliveryAt.toISOString(),
          order.deliveredAt?.toISOString() ?? "",
          order.status,
          order.totalPieces,
          order.deliveredAt
            ? round2(
                (order.deliveredAt.getTime() - order.placedAt.getTime()) /
                  (1000 * 60 * 60),
              )
            : "",
        ]),
      );
      break;
    }

    case "delivery": {
      if (!hasPermission(user, PERMISSIONS.REPORT_OPERATIONS)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      const deliveries = await prisma.delivery.findMany({
        where: { firmId, ...branchFilter, scheduledAt: { gte: range.from, lte: range.to } },
        orderBy: { scheduledAt: "asc" },
        include: {
          order: { select: { orderNumber: true } },
          driver: { include: { user: { select: { name: true } } } },
        },
      });
      csv = toCsv(
        [
          "Delivery",
          "Order",
          "Driver",
          "Scheduled",
          "Delivered",
          "Status",
          "Attempts",
          "To collect",
          "Collected",
        ],
        deliveries.map((delivery) => [
          delivery.deliveryNumber,
          delivery.order.orderNumber,
          delivery.driver?.user.name ?? "",
          delivery.scheduledAt.toISOString(),
          delivery.deliveredAt?.toISOString() ?? "",
          delivery.status,
          delivery.attemptCount,
          num(delivery.amountToCollect),
          num(delivery.amountCollected),
        ]),
      );
      break;
    }

    case "inventory": {
      if (!hasPermission(user, PERMISSIONS.INVENTORY_VIEW)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      const transactions = await prisma.inventoryTransaction.findMany({
        where: { item: { firmId }, ...branchFilter, createdAt: { gte: range.from, lte: range.to } },
        orderBy: { createdAt: "asc" },
        include: {
          item: { select: { sku: true, name: true, unit: true } },
          branch: { select: { name: true } },
          user: { select: { name: true } },
        },
      });
      csv = toCsv(
        ["Date", "SKU", "Item", "Branch", "Type", "Quantity", "Balance", "Unit", "Reference", "By"],
        transactions.map((txn) => [
          txn.createdAt.toISOString(),
          txn.item.sku,
          txn.item.name,
          txn.branch.name,
          txn.type,
          num(txn.quantity),
          num(txn.balanceAfter),
          txn.item.unit,
          txn.reference ?? "",
          txn.user?.name ?? "",
        ]),
      );
      break;
    }

    case "finance": {
      if (!hasPermission(user, PERMISSIONS.REPORT_FINANCE)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      const payments = await prisma.payment.findMany({
        where: {
          firmId,
          ...branchFilter,
          state: "CAPTURED",
          paidAt: { gte: range.from, lte: range.to },
        },
        orderBy: { paidAt: "asc" },
        include: {
          order: { select: { orderNumber: true, customerName: true } },
          branch: { select: { name: true } },
          receivedBy: { select: { name: true } },
        },
      });
      csv = toCsv(
        ["Payment", "Date", "Branch", "Order", "Customer", "Method", "Amount", "Received by"],
        payments.map((payment) => [
          payment.paymentNumber,
          payment.paidAt.toISOString(),
          payment.branch.name,
          payment.order?.orderNumber ?? "",
          payment.order?.customerName ?? "",
          payment.method,
          num(payment.amount),
          payment.receivedBy?.name ?? "",
        ]),
      );
      break;
    }

    default: {
      if (!hasPermission(user, PERMISSIONS.REPORT_SALES)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      filename = "sales-report.csv";
      const orders = await prisma.order.findMany({
        where: {
          firmId,
          ...branchFilter,
          placedAt: { gte: range.from, lte: range.to },
          status: { not: "CANCELLED" },
        },
        orderBy: { placedAt: "asc" },
        include: {
          branch: { select: { name: true } },
          items: { include: { service: { select: { name: true } } } },
        },
      });
      csv = toCsv(
        [
          "Order",
          "Date",
          "Branch",
          "Customer",
          "Phone",
          "Services",
          "Pieces",
          "Subtotal",
          "Discount",
          "GST",
          "Total",
          "Paid",
          "Outstanding",
          "Payment status",
        ],
        orders.map((order) => [
          order.orderNumber,
          order.placedAt.toISOString(),
          order.branch.name,
          order.customerName,
          order.customerPhone,
          [...new Set(order.items.map((item) => item.service.name))].join(" | "),
          order.totalPieces,
          num(order.subtotal),
          num(order.discountAmount),
          num(order.gstAmount),
          num(order.totalAmount),
          num(order.paidAmount),
          num(order.outstandingAmount),
          order.paymentStatus,
        ]),
      );
    }
  }

  // A BOM keeps Excel honest about UTF-8.
  return new NextResponse(`﻿${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
