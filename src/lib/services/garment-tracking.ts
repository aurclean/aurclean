import "server-only";
import { prisma } from "@/lib/prisma";
import { NotFoundError } from "@/lib/action-result";
import {
  GARMENT_CATEGORIES,
  categoryLabel,
  categoryMeta,
} from "@/lib/garment-categories";
import { GARMENT_STATUS_LABELS, STAGE_LABELS } from "@/lib/workflow";
import type { Prisma } from "@/generated/prisma/client";
import type {
  GarmentScanOutcome,
  GarmentStatus,
  ProcessingStage,
  TrackingCategory,
} from "@/generated/prisma/enums";

type Tx = Prisma.TransactionClient;
type Db = Tx | typeof prisma;

/** A garment is off the floor once it has been handed over or written off. */
export const CLOSED_GARMENT_STATUSES: GarmentStatus[] = ["DELIVERED", "RETURNED"];

/** Two reads of the same tag at the same station inside this window are one scan. */
const DUPLICATE_WINDOW_MS = 15 * 60 * 1000;

/** Task states that mean the garment has actually been through that station. */
const DONE_TASK_STATUSES = ["COMPLETED", "PASSED", "SKIPPED"];

export interface RecordScanInput {
  garmentId: string;
  stage: ProcessingStage;
  branchId: string;
  userId: string;
  /** The order the operator had open, when the station knows it. */
  contextOrderId?: string | null;
  /** The category the station was expecting, when it is working one bucket. */
  expectedCategory?: TrackingCategory | null;
  location?: string | null;
  note?: string | null;
}

export interface RecordedScan {
  id: string;
  outcome: GarmentScanOutcome;
  /** Set when the scan was anything other than a clean match. */
  alert: string | null;
}

/**
 * Writes one scan to the ledger and classifies it on the way in.
 *
 * The classification is the whole point: a tag read against the wrong order,
 * from the wrong category bucket, or twice at one station is a problem the
 * operator needs to hear about now, not on a report tomorrow.
 */
export async function recordGarmentScan(
  db: Db,
  input: RecordScanInput,
): Promise<RecordedScan> {
  const garment = await db.garment.findUnique({
    where: { id: input.garmentId },
    select: {
      id: true,
      garmentCode: true,
      orderId: true,
      trackingCategory: true,
      order: { select: { orderNumber: true } },
    },
  });
  if (!garment) throw new NotFoundError("Garment not found");

  let outcome: GarmentScanOutcome = "MATCH";
  let alert: string | null = null;

  if (input.contextOrderId && input.contextOrderId !== garment.orderId) {
    const context = await db.order.findUnique({
      where: { id: input.contextOrderId },
      select: { orderNumber: true },
    });
    outcome = "WRONG_ORDER";
    alert = `${garment.garmentCode} belongs to ${garment.order.orderNumber}, not ${context?.orderNumber ?? "the order on screen"}.`;
  } else if (
    input.expectedCategory &&
    input.expectedCategory !== garment.trackingCategory
  ) {
    outcome = "WRONG_CATEGORY";
    alert = `${garment.garmentCode} is a ${categoryLabel(garment.trackingCategory).toLowerCase()} item, not ${categoryLabel(input.expectedCategory).toLowerCase()}.`;
  } else {
    const recent = await db.garmentScan.findFirst({
      where: {
        garmentId: garment.id,
        stage: input.stage,
        outcome: "MATCH",
        scannedAt: { gte: new Date(Date.now() - DUPLICATE_WINDOW_MS) },
      },
      select: { id: true, scannedAt: true },
    });
    if (recent) {
      outcome = "DUPLICATE";
      alert = `${garment.garmentCode} was already scanned at ${STAGE_LABELS[input.stage].toLowerCase()} a moment ago.`;
    }
  }

  const scan = await db.garmentScan.create({
    data: {
      garmentId: garment.id,
      orderId: garment.orderId,
      contextOrderId: input.contextOrderId ?? garment.orderId,
      branchId: input.branchId,
      trackingCategory: garment.trackingCategory,
      stage: input.stage,
      outcome,
      location: input.location ?? null,
      note: input.note ?? null,
      scannedById: input.userId,
    },
    select: { id: true },
  });

  return { id: scan.id, outcome, alert };
}

/* -------------------------------------------------------------------------- */
/*  Category counts                                                            */
/* -------------------------------------------------------------------------- */

export interface CategoryCount {
  category: TrackingCategory;
  label: string;
  emoji: string;
  prefix: string;
  /** Pieces of this category on the floor right now. */
  onFloor: number;
  ready: number;
  /** Open problems the mismatch centre would list for this category. */
  issues: number;
}

function branchWhere(firmId: string, branchIds: string[] | null): Prisma.GarmentWhereInput {
  return { firmId, ...(branchIds ? { branchId: { in: branchIds } } : {}) };
}

/**
 * The dashboard tiles: how many pieces of each category are in the laundry
 * right now. Delivered garments have left, so they are not counted.
 */
export async function getCategoryCounts(
  firmId: string,
  branchIds: string[] | null,
): Promise<CategoryCount[]> {
  const where = branchWhere(firmId, branchIds);

  // The tile count comes from the same engine the mismatch centre uses, so a
  // badge on the dashboard and the list behind it can never disagree.
  const [onFloor, ready, findings] = await Promise.all([
    prisma.garment.groupBy({
      by: ["trackingCategory"],
      where: { ...where, status: { notIn: CLOSED_GARMENT_STATUSES } },
      _count: { _all: true },
    }),
    prisma.garment.groupBy({
      by: ["trackingCategory"],
      where: { ...where, status: "READY" },
      _count: { _all: true },
    }),
    detectMismatches({ firmId, branchIds }),
  ]);

  const floorBy = new Map(onFloor.map((row) => [row.trackingCategory, row._count._all]));
  const readyBy = new Map(ready.map((row) => [row.trackingCategory, row._count._all]));
  const issuesBy = new Map<TrackingCategory, number>();
  for (const finding of findings) {
    issuesBy.set(finding.category, (issuesBy.get(finding.category) ?? 0) + 1);
  }

  return GARMENT_CATEGORIES.map((meta) => ({
    category: meta.value,
    label: meta.label,
    emoji: meta.emoji,
    prefix: meta.prefix,
    onFloor: floorBy.get(meta.value) ?? 0,
    ready: readyBy.get(meta.value) ?? 0,
    issues: issuesBy.get(meta.value) ?? 0,
  }));
}

/* -------------------------------------------------------------------------- */
/*  Category tracking screen                                                   */
/* -------------------------------------------------------------------------- */

export interface TrackedGarment {
  id: string;
  garmentCode: string;
  category: TrackingCategory;
  categoryLabel: string;
  orderId: string;
  orderNumber: string;
  customerId: string | null;
  customerName: string;
  customerPhone: string;
  description: string;
  /** Pieces of this line on the same order — what the operator counts against. */
  lineQuantity: number;
  status: GarmentStatus;
  statusLabel: string;
  stage: ProcessingStage;
  stageLabel: string;
  location: string;
  expectedDeliveryAt: Date;
  isOverdue: boolean;
  tagPrinted: boolean;
  lastScannedAt: Date | null;
  lastScanStage: ProcessingStage | null;
  scanState: "SCANNED" | "NOT_SCANNED" | "STALE";
  issue: MismatchKind | null;
}

export type MismatchKind =
  | "MISSING"
  | "WRONG_ORDER"
  | "WRONG_GARMENT"
  | "DUPLICATE_SCAN"
  | "NOT_SCANNED";

export interface CategoryPage {
  category: TrackingCategory;
  label: string;
  emoji: string;
  prefix: string;
  total: number;
  page: number;
  pageSize: number;
  rows: TrackedGarment[];
  /** Counts across the whole category, not just this page. */
  summary: MismatchSummary;
}

export interface MismatchSummary {
  total: number;
  correct: number;
  missing: number;
  wrongOrder: number;
  wrongGarment: number;
  duplicate: number;
  notScanned: number;
}

const EMPTY_SUMMARY: MismatchSummary = {
  total: 0,
  correct: 0,
  missing: 0,
  wrongOrder: 0,
  wrongGarment: 0,
  duplicate: 0,
  notScanned: 0,
};

export async function getCategoryPage(params: {
  firmId: string;
  category: TrackingCategory;
  branchIds: string[] | null;
  search?: string;
  stage?: string;
  issueOnly?: boolean;
  includeDelivered?: boolean;
  page?: number;
  pageSize?: number;
}): Promise<CategoryPage> {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(100, Math.max(10, params.pageSize ?? 25));
  const meta = categoryMeta(params.category);
  const search = params.search?.trim();

  const findings = await detectMismatches({
    firmId: params.firmId,
    branchIds: params.branchIds,
    category: params.category,
  });
  const findingByGarment = new Map(findings.map((f) => [f.garmentId, f]));

  const where: Prisma.GarmentWhereInput = {
    ...branchWhere(params.firmId, params.branchIds),
    trackingCategory: params.category,
    ...(params.includeDelivered ? {} : { status: { notIn: CLOSED_GARMENT_STATUSES } }),
    ...(params.stage && params.stage !== "all"
      ? { currentStage: params.stage as ProcessingStage }
      : {}),
    ...(params.issueOnly ? { id: { in: findings.map((f) => f.garmentId) } } : {}),
    ...(search
      ? {
          OR: [
            { garmentCode: { contains: search, mode: "insensitive" } },
            { order: { orderNumber: { contains: search, mode: "insensitive" } } },
            { order: { customerName: { contains: search, mode: "insensitive" } } },
            { order: { customerPhone: { contains: search.replace(/\D/g, "") || search } } },
          ],
        }
      : {}),
  };

  const [garments, total] = await Promise.all([
    prisma.garment.findMany({
      where,
      orderBy: [{ order: { expectedDeliveryAt: "asc" } }, { garmentCode: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        garmentType: { select: { name: true } },
        service: { select: { name: true } },
        orderItem: { select: { quantity: true } },
        order: {
          select: {
            id: true,
            orderNumber: true,
            customerId: true,
            customerName: true,
            customerPhone: true,
            expectedDeliveryAt: true,
            tagPrintCount: true,
          },
        },
        scans: {
          orderBy: { scannedAt: "desc" },
          select: { stage: true, outcome: true, scannedAt: true },
        },
        tasks: { select: { stage: true, status: true } },
      },
    }),
    prisma.garment.count({ where }),
  ]);

  const now = Date.now();

  return {
    category: params.category,
    label: meta.label,
    emoji: meta.emoji,
    prefix: meta.prefix,
    total,
    page,
    pageSize,
    summary: summarise(findings, await countCategory(params)),
    rows: garments.map((garment) => {
      const lastScan = garment.scans[0] ?? null;
      const finding = findingByGarment.get(garment.id) ?? null;
      const scannedStages = new Set(
        garment.scans.filter((scan) => scan.outcome === "MATCH").map((scan) => scan.stage),
      );
      const clearedUnscanned = garment.tasks.some(
        (task) =>
          ["COMPLETED", "PASSED", "SKIPPED"].includes(task.status) &&
          !scannedStages.has(task.stage),
      );
      return {
        id: garment.id,
        garmentCode: garment.garmentCode,
        category: garment.trackingCategory,
        categoryLabel: meta.label,
        orderId: garment.order.id,
        orderNumber: garment.order.orderNumber,
        customerId: garment.order.customerId,
        customerName: garment.order.customerName,
        customerPhone: garment.order.customerPhone,
        description: `${garment.garmentType.name} · ${garment.service.name}${garment.color ? ` · ${garment.color}` : ""}`,
        lineQuantity: garment.orderItem?.quantity ?? 1,
        status: garment.status,
        statusLabel: GARMENT_STATUS_LABELS[garment.status],
        stage: garment.currentStage,
        stageLabel: STAGE_LABELS[garment.currentStage],
        location: STAGE_LABELS[garment.currentStage],
        expectedDeliveryAt: garment.order.expectedDeliveryAt,
        isOverdue:
          garment.order.expectedDeliveryAt.getTime() < now &&
          !CLOSED_GARMENT_STATUSES.includes(garment.status),
        tagPrinted: garment.order.tagPrintCount > 0,
        lastScannedAt: lastScan?.scannedAt ?? null,
        lastScanStage: lastScan?.stage ?? null,
        scanState: !lastScan ? "NOT_SCANNED" : clearedUnscanned ? "STALE" : "SCANNED",
        issue: finding?.kind ?? null,
      };
    }),
  };
}

async function countCategory(params: {
  firmId: string;
  category: TrackingCategory;
  branchIds: string[] | null;
  includeDelivered?: boolean;
}): Promise<number> {
  return prisma.garment.count({
    where: {
      ...branchWhere(params.firmId, params.branchIds),
      trackingCategory: params.category,
      ...(params.includeDelivered ? {} : { status: { notIn: CLOSED_GARMENT_STATUSES } }),
    },
  });
}

/* -------------------------------------------------------------------------- */
/*  Mismatch detection                                                         */
/* -------------------------------------------------------------------------- */

export interface MismatchFinding {
  garmentId: string;
  garmentCode: string;
  category: TrackingCategory;
  categoryLabel: string;
  kind: MismatchKind;
  /** True when a person raised it rather than the system deriving it. */
  reported: boolean;
  exceptionId: string | null;
  detail: string;
  orderId: string;
  orderNumber: string;
  customerId: string | null;
  customerName: string;
  customerPhone: string;
  branchId: string;
  expectedLocation: string;
  lastScanLocation: string | null;
  lastScanAt: Date | null;
  lastScanBy: string | null;
  status: GarmentStatus;
  statusLabel: string;
  stage: ProcessingStage;
  stageLabel: string;
  expectedDeliveryAt: Date;
}

export const MISMATCH_LABELS: Record<MismatchKind, string> = {
  MISSING: "Missing",
  WRONG_ORDER: "Wrong order",
  WRONG_GARMENT: "Wrong garment",
  DUPLICATE_SCAN: "Duplicate scan",
  NOT_SCANNED: "Not scanned",
};

/** Ordered worst-first, which is also the order the centre lists them in. */
const KIND_RANK: MismatchKind[] = [
  "MISSING",
  "WRONG_GARMENT",
  "WRONG_ORDER",
  "DUPLICATE_SCAN",
  "NOT_SCANNED",
];

/**
 * Compares what an order says it holds against what has actually been scanned,
 * and reports every way the two disagree.
 *
 * Findings are derived on every read rather than stored, so a problem that has
 * since been put right simply stops appearing — the one exception being
 * problems a person raised explicitly (a garment reported missing), which live
 * in `GarmentException` until someone closes them.
 */
export async function detectMismatches(params: {
  firmId: string;
  branchIds: string[] | null;
  category?: TrackingCategory | null;
  limit?: number;
}): Promise<MismatchFinding[]> {
  const where: Prisma.GarmentWhereInput = {
    ...branchWhere(params.firmId, params.branchIds),
    ...(params.category ? { trackingCategory: params.category } : {}),
    status: { notIn: CLOSED_GARMENT_STATUSES },
  };

  const garments = await prisma.garment.findMany({
    where,
    select: {
      id: true,
      garmentCode: true,
      branchId: true,
      trackingCategory: true,
      status: true,
      currentStage: true,
      orderId: true,
      order: {
        select: {
          id: true,
          orderNumber: true,
          customerId: true,
          customerName: true,
          customerPhone: true,
          expectedDeliveryAt: true,
        },
      },
      scans: {
        orderBy: { scannedAt: "desc" },
        select: {
          id: true,
          stage: true,
          outcome: true,
          scannedAt: true,
          location: true,
          contextOrderId: true,
          contextOrder: { select: { orderNumber: true } },
          scannedBy: { select: { name: true } },
        },
      },
      tasks: { select: { stage: true, status: true } },
      exceptions: {
        where: { status: "OPEN" },
        orderBy: { reportedAt: "desc" },
        select: { id: true, type: true, detail: true, reportedAt: true },
      },
    },
  });

  const findings: MismatchFinding[] = [];

  for (const garment of garments) {
    const latest = garment.scans[0] ?? null;

    const base = {
      garmentId: garment.id,
      garmentCode: garment.garmentCode,
      category: garment.trackingCategory,
      categoryLabel: categoryLabel(garment.trackingCategory),
      orderId: garment.order.id,
      orderNumber: garment.order.orderNumber,
      customerId: garment.order.customerId,
      customerName: garment.order.customerName,
      customerPhone: garment.order.customerPhone,
      branchId: garment.branchId,
      expectedLocation: STAGE_LABELS[garment.currentStage],
      lastScanLocation: latest
        ? (latest.location ?? STAGE_LABELS[latest.stage])
        : null,
      lastScanAt: latest?.scannedAt ?? null,
      lastScanBy: latest?.scannedBy?.name ?? null,
      status: garment.status,
      statusLabel: GARMENT_STATUS_LABELS[garment.status],
      stage: garment.currentStage,
      stageLabel: STAGE_LABELS[garment.currentStage],
      expectedDeliveryAt: garment.order.expectedDeliveryAt,
    };

    // 1. A person raised it. That outranks anything derived.
    const raised = garment.exceptions[0];
    if (raised) {
      findings.push({
        ...base,
        kind: raised.type as MismatchKind,
        reported: true,
        exceptionId: raised.id,
        detail: raised.detail ?? MISMATCH_LABELS[raised.type as MismatchKind],
      });
      continue;
    }

    // 2. The system wrote the garment off without anyone filing a report.
    if (garment.status === "LOST") {
      findings.push({
        ...base,
        kind: "MISSING",
        reported: false,
        exceptionId: null,
        detail: `Marked lost and never recovered`,
      });
      continue;
    }

    // 3. Scanned against an order it does not belong to.
    const wrongOrder = garment.scans.find((scan) => scan.outcome === "WRONG_ORDER");
    if (wrongOrder) {
      findings.push({
        ...base,
        kind: "WRONG_ORDER",
        reported: false,
        exceptionId: null,
        detail: `Scanned under ${wrongOrder.contextOrder?.orderNumber ?? "another order"}; it belongs to ${garment.order.orderNumber}`,
      });
      continue;
    }

    // 4. Read from the wrong category bucket.
    const wrongCategory = garment.scans.find((scan) => scan.outcome === "WRONG_CATEGORY");
    if (wrongCategory) {
      findings.push({
        ...base,
        kind: "WRONG_GARMENT",
        reported: false,
        exceptionId: null,
        detail: `Scanned as a different category at ${STAGE_LABELS[wrongCategory.stage].toLowerCase()}`,
      });
      continue;
    }

    // 5. The same tag read twice at one station.
    const duplicate = garment.scans.find((scan) => scan.outcome === "DUPLICATE");
    if (duplicate) {
      findings.push({
        ...base,
        kind: "DUPLICATE_SCAN",
        reported: false,
        exceptionId: null,
        detail: `Read twice at ${STAGE_LABELS[duplicate.stage].toLowerCase()}`,
      });
      continue;
    }

    // 6. Cleared a station without anyone scanning it there. A garment merely
    //    *queued* at a station has nothing to answer for — it is the stations
    //    it has already passed that must each have a scan behind them.
    const scannedStages = new Set(
      garment.scans.filter((scan) => scan.outcome === "MATCH").map((scan) => scan.stage),
    );
    const skipped = garment.tasks
      .filter((task) => DONE_TASK_STATUSES.includes(task.status))
      .map((task) => task.stage)
      .filter((stage) => !scannedStages.has(stage));

    if (skipped.length > 0) {
      findings.push({
        ...base,
        kind: "NOT_SCANNED",
        reported: false,
        exceptionId: null,
        detail: `Cleared ${skipped.map((stage) => STAGE_LABELS[stage].toLowerCase()).join(", ")} with no scan recorded`,
      });
    }
  }

  findings.sort((a, b) => {
    const rank = KIND_RANK.indexOf(a.kind) - KIND_RANK.indexOf(b.kind);
    if (rank !== 0) return rank;
    return a.expectedDeliveryAt.getTime() - b.expectedDeliveryAt.getTime();
  });

  return params.limit ? findings.slice(0, params.limit) : findings;
}

export function summarise(findings: MismatchFinding[], total: number): MismatchSummary {
  const summary: MismatchSummary = { ...EMPTY_SUMMARY, total };
  for (const finding of findings) {
    switch (finding.kind) {
      case "MISSING":
        summary.missing += 1;
        break;
      case "WRONG_ORDER":
        summary.wrongOrder += 1;
        break;
      case "WRONG_GARMENT":
        summary.wrongGarment += 1;
        break;
      case "DUPLICATE_SCAN":
        summary.duplicate += 1;
        break;
      case "NOT_SCANNED":
        summary.notScanned += 1;
        break;
    }
  }
  summary.correct = Math.max(0, total - findings.length);
  return summary;
}

/** The mismatch centre's headline: one row per category. */
export async function getMismatchOverview(
  firmId: string,
  branchIds: string[] | null,
): Promise<
  Array<{
    category: TrackingCategory;
    label: string;
    emoji: string;
    summary: MismatchSummary;
  }>
> {
  const [findings, totals] = await Promise.all([
    detectMismatches({ firmId, branchIds }),
    prisma.garment.groupBy({
      by: ["trackingCategory"],
      where: {
        ...branchWhere(firmId, branchIds),
        status: { notIn: CLOSED_GARMENT_STATUSES },
      },
      _count: { _all: true },
    }),
  ]);

  const totalBy = new Map(totals.map((row) => [row.trackingCategory, row._count._all]));
  const byCategory = new Map<TrackingCategory, MismatchFinding[]>();
  for (const finding of findings) {
    const list = byCategory.get(finding.category) ?? [];
    list.push(finding);
    byCategory.set(finding.category, list);
  }

  return GARMENT_CATEGORIES.map((meta) => ({
    category: meta.value,
    label: meta.label,
    emoji: meta.emoji,
    summary: summarise(byCategory.get(meta.value) ?? [], totalBy.get(meta.value) ?? 0),
  })).filter((row) => row.summary.total > 0);
}
