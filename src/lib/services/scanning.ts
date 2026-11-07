import "server-only";
import { prisma } from "@/lib/prisma";
import { num } from "@/lib/money";
import { parseScan } from "@/lib/codes";
import { GARMENT_STATUS_LABELS, ORDER_STATUS_LABELS, STAGE_LABELS } from "@/lib/workflow";
import { categoryMeta } from "@/lib/garment-categories";
import { recordGarmentScan } from "@/lib/services/garment-tracking";
import type { Prisma } from "@/generated/prisma/client";
import type { ScanSource } from "@/generated/prisma/enums";

/** A second read of the same tag inside this window is a duplicate, not a new scan. */
const DUPLICATE_WINDOW_MS = 90 * 1000;

/** Everything the fast result panel shows for a garment that scanned clean. */
export interface ScannedGarmentCard {
  garmentId: string;
  garmentCode: string;
  /** The garment's own branch — used to attribute the scan event when the
   *  operator (e.g. a firm-wide admin) has no fixed branch of their own. */
  branchId: string;
  categoryLabel: string;
  categoryEmoji: string;
  garmentTypeName: string;
  serviceName: string;
  customerId: string | null;
  customerName: string;
  customerPhone: string;
  orderId: string;
  orderNumber: string;
  orderItemsSummary: string;
  status: string;
  statusLabel: string;
  stage: string;
  stageLabel: string;
  paymentStatus: string;
  totalAmount: number;
  paidAmount: number;
  outstandingAmount: number;
  expectedDeliveryAt: string;
  lastScannedAt: string | null;
  /** A soft, non-blocking notice — an unusual status or a gap in the scan
   *  trail — shown inline on an otherwise clean FOUND card. */
  warning: string | null;
}

/** What the panel shows when the scanned garment does not belong where expected. */
export interface MismatchCard {
  garmentId: string;
  garmentCode: string;
  categoryLabel: string;
  actualCustomerName: string;
  actualOrderId: string;
  actualOrderNumber: string;
  expectedOrderId: string | null;
  expectedOrderNumber: string | null;
  expectedCustomerName: string | null;
  expectedCategoryLabel: string | null;
  detail: string;
}

export type ScanResultKind = "FOUND" | "MISMATCH" | "DUPLICATE" | "NOT_FOUND";

export interface ScanResult {
  ok: boolean;
  kind: ScanResultKind;
  message: string;
  garment: ScannedGarmentCard | null;
  mismatch: MismatchCard | null;
  /** Set for DUPLICATE — how long ago the previous scan of this tag was. */
  secondsAgo: number | null;
}

const GARMENT_CARD_INCLUDE = {
  garmentType: { select: { name: true } },
  service: { select: { name: true } },
  order: {
    select: {
      id: true,
      orderNumber: true,
      status: true,
      paymentStatus: true,
      customerId: true,
      customerName: true,
      customerPhone: true,
      expectedDeliveryAt: true,
      totalAmount: true,
      paidAmount: true,
      outstandingAmount: true,
      items: {
        include: {
          service: { select: { name: true } },
          garmentType: { select: { name: true } },
        },
      },
    },
  },
  lastScannedBy: { select: { name: true } },
} as const;

type GarmentWithCard = Prisma.GarmentGetPayload<{ include: typeof GARMENT_CARD_INCLUDE }>;

function itemsSummary(order: GarmentWithCard["order"]): string {
  return order.items
    .map((item) => `${item.quantity}× ${item.garmentType.name}`)
    .join(", ");
}

function toCard(garment: GarmentWithCard, warning: string | null = null): ScannedGarmentCard {
  const meta = categoryMeta(garment.trackingCategory);
  return {
    garmentId: garment.id,
    garmentCode: garment.garmentCode,
    branchId: garment.branchId,
    categoryLabel: meta.label,
    categoryEmoji: meta.emoji,
    garmentTypeName: garment.garmentType.name,
    serviceName: garment.service.name,
    customerId: garment.order.customerId,
    customerName: garment.order.customerName,
    customerPhone: garment.order.customerPhone,
    orderId: garment.order.id,
    orderNumber: garment.order.orderNumber,
    orderItemsSummary: itemsSummary(garment.order),
    status: garment.status,
    statusLabel: GARMENT_STATUS_LABELS[garment.status],
    stage: garment.currentStage,
    stageLabel: STAGE_LABELS[garment.currentStage],
    paymentStatus: garment.order.paymentStatus,
    totalAmount: num(garment.order.totalAmount),
    paidAmount: num(garment.order.paidAmount),
    outstandingAmount: num(garment.order.outstandingAmount),
    expectedDeliveryAt: garment.order.expectedDeliveryAt.toISOString(),
    lastScannedAt: garment.lastScannedAt?.toISOString() ?? null,
    warning,
  };
}

const DONE_TASK_STATUSES = ["COMPLETED", "PASSED", "SKIPPED"];
const UNUSUAL_STATUSES = ["REWASH", "REWORK", "QC_FAILED", "DAMAGED", "RETURNED"];

/**
 * A garment can scan clean and still be worth a second look: it was read
 * against another order or category earlier and never reconciled, it is
 * sitting in a status that is not part of the normal flow, or it cleared a
 * station without a scan ever being recorded there. None of these block the
 * scan — they surface as a soft notice on the FOUND card, or (for a still-open
 * wrong-order/wrong-category read) as a full mismatch.
 */
async function findPersistedIssue(
  garment: GarmentWithCard,
): Promise<{ mismatch: MismatchCard | null; warning: string | null }> {
  const [scans, tasks] = await Promise.all([
    prisma.garmentScan.findMany({
      where: { garmentId: garment.id },
      orderBy: { scannedAt: "desc" },
      take: 20,
      select: {
        stage: true,
        outcome: true,
        contextOrder: { select: { orderNumber: true, customerName: true } },
      },
    }),
    prisma.processingTask.findMany({
      where: { garmentId: garment.id },
      select: { stage: true, status: true },
    }),
  ]);

  const categoryLabel = categoryMeta(garment.trackingCategory).label;
  const latestByOutcome = scans.find((scan) => scan.outcome !== "MATCH");
  if (latestByOutcome && latestByOutcome.outcome === "WRONG_ORDER") {
    return {
      mismatch: {
        garmentId: garment.id,
        garmentCode: garment.garmentCode,
        categoryLabel,
        actualCustomerName: garment.order.customerName,
        actualOrderId: garment.order.id,
        actualOrderNumber: garment.order.orderNumber,
        expectedOrderId: null,
        expectedOrderNumber: latestByOutcome.contextOrder?.orderNumber ?? null,
        expectedCustomerName: latestByOutcome.contextOrder?.customerName ?? null,
        expectedCategoryLabel: categoryLabel,
        detail: `Last read under ${latestByOutcome.contextOrder?.orderNumber ?? "another order"}; it belongs to ${garment.order.orderNumber}.`,
      },
      warning: null,
    };
  }
  if (latestByOutcome && latestByOutcome.outcome === "WRONG_CATEGORY") {
    return {
      mismatch: {
        garmentId: garment.id,
        garmentCode: garment.garmentCode,
        categoryLabel,
        actualCustomerName: garment.order.customerName,
        actualOrderId: garment.order.id,
        actualOrderNumber: garment.order.orderNumber,
        expectedOrderId: garment.order.id,
        expectedOrderNumber: garment.order.orderNumber,
        expectedCustomerName: garment.order.customerName,
        expectedCategoryLabel: categoryLabel,
        detail: `Last scanned into the wrong category's bucket at ${STAGE_LABELS[latestByOutcome.stage]}.`,
      },
      warning: null,
    };
  }

  if (UNUSUAL_STATUSES.includes(garment.status)) {
    return {
      mismatch: null,
      warning: `Unexpected status — ${GARMENT_STATUS_LABELS[garment.status]}.`,
    };
  }

  const scannedStages = new Set(
    scans.filter((scan) => scan.outcome === "MATCH").map((scan) => scan.stage),
  );
  const skipped = tasks
    .filter((task) => DONE_TASK_STATUSES.includes(task.status) && !scannedStages.has(task.stage))
    .map((task) => STAGE_LABELS[task.stage]);
  if (skipped.length > 0) {
    return {
      mismatch: null,
      warning: `Cleared ${skipped.join(", ")} with no scan on record.`,
    };
  }

  return { mismatch: null, warning: null };
}

/**
 * Resolves one read off the scanner — camera, USB/Bluetooth keyboard-emulation
 * scanner, or a manually typed code — to a garment, and works out which of the
 * four states the fast result panel shows.
 *
 * Garment is the unit here, not the order: a plain garment tag or code is the
 * common case, an order tag or number resolves to the next garment on that
 * order still worth looking at, and everything else is "tag not found".
 */
export async function resolveGarmentScan(params: {
  rawCode: string;
  /** The order the operator is working through, if they set one — the piece
   *  that turns up on a *different* order is the mismatch case. */
  contextOrderId?: string | null;
  branchIds: string[] | null;
  /** The operator's own branch, when they have one. A firm-wide admin with
   *  no fixed branch (branchIds === null, above) has none — the scan is then
   *  attributed to the garment's own branch instead, once it's resolved. */
  branchId: string | null;
  firmId: string;
  userId: string;
}): Promise<ScanResult> {
  const code = params.rawCode.trim();
  if (!code) {
    return {
      ok: false,
      kind: "NOT_FOUND",
      message: "Nothing was scanned",
      garment: null,
      mismatch: null,
      secondsAgo: null,
    };
  }

  const parsed = parseScan(code);
  const branchWhere = params.branchIds
    ? { branchId: { in: params.branchIds }, firmId: params.firmId }
    : { firmId: params.firmId };

  let garment: GarmentWithCard | null = null;

  if (parsed.kind === "garment" || parsed.kind === "unknown") {
    garment = await prisma.garment.findFirst({
      where: {
        ...branchWhere,
        OR: [
          { garmentCode: parsed.value },
          { barcodeValue: parsed.value },
          { qrPayload: code },
        ],
      },
      include: GARMENT_CARD_INCLUDE,
    });
  }

  if (!garment && (parsed.kind === "order" || parsed.kind === "unknown")) {
    const order = await prisma.order.findFirst({
      where: { ...branchWhere, orderNumber: { equals: parsed.value, mode: "insensitive" } },
      select: { id: true },
    });
    if (order) {
      garment = await prisma.garment.findFirst({
        where: { orderId: order.id, status: { notIn: ["DELIVERED", "LOST"] } },
        orderBy: { garmentCode: "asc" },
        include: GARMENT_CARD_INCLUDE,
      });
    }
  }

  if (!garment) {
    return {
      ok: false,
      kind: "NOT_FOUND",
      message: `"${code}" is not a tag this system issued.`,
      garment: null,
      mismatch: null,
      secondsAgo: null,
    };
  }

  // Same tag, read again inside the window — do not create a second record,
  // just say so.
  const recentScan = await prisma.garmentScan.findFirst({
    where: { garmentId: garment.id, scannedAt: { gte: new Date(Date.now() - DUPLICATE_WINDOW_MS) } },
    orderBy: { scannedAt: "desc" },
    select: { scannedAt: true },
  });
  if (recentScan) {
    const secondsAgo = Math.max(1, Math.round((Date.now() - recentScan.scannedAt.getTime()) / 1000));
    return {
      ok: true,
      kind: "DUPLICATE",
      message: `${garment.garmentCode} already scanned ${secondsAgo} second${secondsAgo === 1 ? "" : "s"} ago`,
      garment: toCard(garment),
      mismatch: null,
      secondsAgo,
    };
  }

  // Scanning against an order context that is not this garment's own order.
  if (params.contextOrderId && params.contextOrderId !== garment.orderId) {
    const context = await prisma.order.findUnique({
      where: { id: params.contextOrderId },
      select: { id: true, orderNumber: true, customerName: true },
    });
    return {
      ok: false,
      kind: "MISMATCH",
      message: `${garment.garmentCode} belongs to ${garment.order.orderNumber}, not ${context?.orderNumber ?? "the order on screen"}.`,
      garment: null,
      mismatch: {
        garmentId: garment.id,
        garmentCode: garment.garmentCode,
        categoryLabel: categoryMeta(garment.trackingCategory).label,
        actualCustomerName: garment.order.customerName,
        actualOrderId: garment.order.id,
        actualOrderNumber: garment.order.orderNumber,
        expectedOrderId: context?.id ?? params.contextOrderId,
        expectedOrderNumber: context?.orderNumber ?? null,
        expectedCustomerName: context?.customerName ?? null,
        expectedCategoryLabel: categoryMeta(garment.trackingCategory).label,
        detail: `Scanned under ${context?.orderNumber ?? "another order"}; it belongs to ${garment.order.orderNumber}.`,
      },
      secondsAgo: null,
    };
  }

  // The garment's order was cancelled or refunded — this tag is no longer
  // live and scanning it into the normal workflow would be silently wrong.
  if (garment.order.status === "CANCELLED" || garment.order.status === "REFUNDED") {
    return {
      ok: false,
      kind: "MISMATCH",
      message: `${garment.garmentCode}'s order (${garment.order.orderNumber}) was ${garment.order.status.toLowerCase()} — this tag is inactive.`,
      garment: null,
      mismatch: {
        garmentId: garment.id,
        garmentCode: garment.garmentCode,
        categoryLabel: categoryMeta(garment.trackingCategory).label,
        actualCustomerName: garment.order.customerName,
        actualOrderId: garment.order.id,
        actualOrderNumber: garment.order.orderNumber,
        expectedOrderId: null,
        expectedOrderNumber: null,
        expectedCustomerName: null,
        expectedCategoryLabel: null,
        detail: `${garment.order.orderNumber} is ${garment.order.status.toLowerCase()}. Confirm with an office manager before doing anything with this garment.`,
      },
      secondsAgo: null,
    };
  }

  // A garment already reported missing is still found — but that is news, not
  // a routine match.
  const openMissing = await prisma.garmentException.findFirst({
    where: { garmentId: garment.id, status: "OPEN", type: "MISSING" },
    select: { detail: true },
  });
  if (openMissing) {
    return {
      ok: false,
      kind: "MISMATCH",
      message: `${garment.garmentCode} was reported missing.`,
      garment: null,
      mismatch: {
        garmentId: garment.id,
        garmentCode: garment.garmentCode,
        categoryLabel: categoryMeta(garment.trackingCategory).label,
        actualCustomerName: garment.order.customerName,
        actualOrderId: garment.order.id,
        actualOrderNumber: garment.order.orderNumber,
        expectedOrderId: null,
        expectedOrderNumber: null,
        expectedCustomerName: null,
        expectedCategoryLabel: null,
        detail: openMissing.detail ?? "Reported missing — recover it before scanning it back in.",
      },
      secondsAgo: null,
    };
  }

  // No context was given, but the garment's own history may already flag a
  // problem — an unreconciled wrong-order/wrong-category read, an unusual
  // status, or a gap in the scan trail.
  const persisted = await findPersistedIssue(garment);
  if (persisted.mismatch) {
    return {
      ok: false,
      kind: "MISMATCH",
      message: persisted.mismatch.detail,
      garment: null,
      mismatch: persisted.mismatch,
      secondsAgo: null,
    };
  }

  // A clean match — write it to the ledger and stamp the garment right away,
  // so the next scan of the same tag falls into the duplicate window above.
  await recordGarmentScan(prisma, {
    garmentId: garment.id,
    stage: garment.currentStage,
    branchId: params.branchId ?? garment.branchId,
    userId: params.userId,
    contextOrderId: garment.orderId,
    note: "Scanned at the scan workspace",
  });
  await prisma.garment.update({
    where: { id: garment.id },
    data: { lastScannedAt: new Date(), lastScannedById: params.userId },
  });

  return {
    ok: true,
    kind: "FOUND",
    message: `${garment.garmentCode} — ${garment.order.customerName} (${garment.order.orderNumber})`,
    garment: toCard(garment, persisted.warning),
    mismatch: null,
    secondsAgo: null,
  };
}

export async function logScan(params: {
  /** Null for a firm-wide admin with no fixed branch, scanning a code that
   *  didn't resolve to a garment — there is then no branch to attribute the
   *  event to, so it's skipped rather than failing the whole scan action. */
  branchId: string | null;
  firmId: string;
  rawCode: string;
  result: ScanResult;
  source: ScanSource;
  userId: string;
  action?: string | null;
}): Promise<void> {
  const branchId = params.branchId ?? params.result.garment?.branchId ?? null;
  if (!branchId) return;

  const orderId = params.result.garment?.orderId ?? params.result.mismatch?.actualOrderId ?? null;
  const garmentCode = params.result.garment?.garmentCode ?? params.result.mismatch?.garmentCode ?? null;

  await prisma.scanEvent.create({
    data: {
      branchId,
      firmId: params.firmId,
      rawCode: params.rawCode.slice(0, 200),
      resolvedAs: garmentCode ? "GARMENT" : "UNKNOWN",
      orderId,
      garmentCode,
      succeeded: params.result.kind === "FOUND",
      message: params.result.message,
      source: params.source,
      action: params.action ?? null,
      scannedById: params.userId,
    },
  });
}

export interface ScanHistoryRow {
  id: string;
  rawCode: string;
  resolvedAs: string;
  succeeded: boolean;
  message: string | null;
  action: string | null;
  source: string;
  scannedAt: string;
  orderId: string | null;
  orderNumber: string | null;
  customerName: string | null;
  garmentCode: string | null;
  scannedBy: string | null;
}

export async function listScanHistory(params: {
  firmId: string;
  branchIds: string[] | null;
  limit?: number;
  onlyFailures?: boolean;
  search?: string;
}): Promise<ScanHistoryRow[]> {
  const search = params.search?.trim();
  const rows = await prisma.scanEvent.findMany({
    where: {
      firmId: params.firmId,
      ...(params.branchIds ? { branchId: { in: params.branchIds } } : {}),
      ...(params.onlyFailures ? { succeeded: false } : {}),
      ...(search
        ? {
            OR: [
              { rawCode: { contains: search, mode: "insensitive" } },
              { garmentCode: { contains: search, mode: "insensitive" } },
              { order: { orderNumber: { contains: search, mode: "insensitive" } } },
              { order: { customerName: { contains: search, mode: "insensitive" } } },
            ],
          }
        : {}),
    },
    orderBy: { scannedAt: "desc" },
    take: params.limit ?? 40,
    include: {
      order: { select: { orderNumber: true, customerName: true } },
      scannedBy: { select: { name: true } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    rawCode: row.rawCode,
    resolvedAs: row.resolvedAs,
    succeeded: row.succeeded,
    message: row.message,
    action: row.action,
    source: row.source,
    scannedAt: row.scannedAt.toISOString(),
    orderId: row.orderId,
    orderNumber: row.order?.orderNumber ?? null,
    customerName: row.order?.customerName ?? null,
    garmentCode: row.garmentCode,
    scannedBy: row.scannedBy?.name ?? null,
  }));
}
