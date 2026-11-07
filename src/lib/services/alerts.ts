import "server-only";
import { prisma } from "@/lib/prisma";
import { num } from "@/lib/money";
import { isGlobalRole } from "@/lib/rbac";
import { detectMismatches } from "@/lib/services/garment-tracking";
import { requireFirmId, type SessionUser } from "@/lib/session";

export type AlertKind =
  | "MISMATCH"
  | "MISSING"
  | "DUPLICATE_SCAN"
  | "DELAYED"
  | "PENDING_PAYMENT";

export interface Alert {
  id: string;
  kind: AlertKind;
  title: string;
  detail: string;
  href: string;
  tone: "danger" | "warning";
  at: string;
}

export interface AlertFeed {
  alerts: Alert[];
  total: number;
  byKind: Record<AlertKind, number>;
}

const EMPTY_BY_KIND: Record<AlertKind, number> = {
  MISMATCH: 0,
  MISSING: 0,
  DUPLICATE_SCAN: 0,
  DELAYED: 0,
  PENDING_PAYMENT: 0,
};

/**
 * What the bell knows about.
 *
 * Every alert is derived from live data and carries the link to the record it
 * is about, so the notification is a way into the work rather than a message to
 * be dismissed. Nothing here is stored, so an alert disappears the moment the
 * thing it is complaining about is put right.
 */
export async function getAlerts(user: SessionUser, limit = 30): Promise<AlertFeed> {
  const firmId = requireFirmId(user);
  const branchIds = isGlobalRole(user.role)
    ? null
    : user.branchId
      ? [user.branchId]
      : [];

  const branchWhere = { firmId, ...(branchIds ? { branchId: { in: branchIds } } : {}) };
  const now = new Date();

  const canSeeTracking = user.permissions.includes("tracking.view" as never);
  const canSeeMoney = user.permissions.includes("billing.view" as never);

  const [findings, delayed, unpaid] = await Promise.all([
    canSeeTracking ? detectMismatches({ firmId, branchIds, limit: 40 }) : Promise.resolve([]),
    prisma.order.findMany({
      where: {
        ...branchWhere,
        status: { notIn: ["DELIVERED", "CANCELLED", "REFUNDED"] },
        expectedDeliveryAt: { lt: now },
      },
      orderBy: { expectedDeliveryAt: "asc" },
      take: 12,
      select: {
        id: true,
        orderNumber: true,
        customerName: true,
        expectedDeliveryAt: true,
        totalPieces: true,
      },
    }),
    canSeeMoney
      ? prisma.order.findMany({
          where: {
            ...branchWhere,
            status: { in: ["READY", "OUT_FOR_DELIVERY", "DELIVERED"] },
            outstandingAmount: { gt: 0 },
          },
          orderBy: { outstandingAmount: "desc" },
          take: 10,
          select: {
            id: true,
            orderNumber: true,
            customerName: true,
            outstandingAmount: true,
            updatedAt: true,
          },
        })
      : Promise.resolve([]),
  ]);

  const alerts: Alert[] = [];

  for (const finding of findings) {
    const kind: AlertKind =
      finding.kind === "MISSING"
        ? "MISSING"
        : finding.kind === "DUPLICATE_SCAN"
          ? "DUPLICATE_SCAN"
          : "MISMATCH";

    // A garment merely waiting to be scanned is not worth interrupting anyone.
    if (finding.kind === "NOT_SCANNED") continue;

    alerts.push({
      id: `finding-${finding.garmentId}-${finding.kind}`,
      kind,
      title:
        kind === "MISSING"
          ? `${finding.garmentCode} is missing`
          : kind === "DUPLICATE_SCAN"
            ? `${finding.garmentCode} was scanned twice`
            : `${finding.garmentCode} does not match its order`,
      detail: `${finding.detail} · ${finding.customerName}`,
      href: `/mismatch?q=${finding.garmentCode}`,
      tone: "danger",
      at: (finding.lastScanAt ?? finding.expectedDeliveryAt).toISOString(),
    });
  }

  for (const order of delayed) {
    alerts.push({
      id: `delayed-${order.id}`,
      kind: "DELAYED",
      title: `${order.orderNumber} is past its delivery date`,
      detail: `${order.customerName} · ${order.totalPieces} pieces`,
      href: `/orders/${order.id}`,
      tone: "warning",
      at: order.expectedDeliveryAt.toISOString(),
    });
  }

  for (const order of unpaid) {
    alerts.push({
      id: `unpaid-${order.id}`,
      kind: "PENDING_PAYMENT",
      title: `${order.orderNumber} still owes money`,
      detail: `${order.customerName} · ₹${num(order.outstandingAmount).toFixed(2)} outstanding`,
      href: `/billing?tab=outstanding&q=${order.orderNumber}`,
      tone: "warning",
      at: order.updatedAt.toISOString(),
    });
  }

  const byKind = { ...EMPTY_BY_KIND };
  for (const alert of alerts) byKind[alert.kind] += 1;

  // Problems first, then whatever happened most recently.
  alerts.sort((a, b) => {
    if (a.tone !== b.tone) return a.tone === "danger" ? -1 : 1;
    return b.at.localeCompare(a.at);
  });

  return { alerts: alerts.slice(0, limit), total: alerts.length, byKind };
}
