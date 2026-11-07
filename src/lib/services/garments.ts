import "server-only";
import { prisma } from "@/lib/prisma";
import { buildBarcodeValue, buildQrPayload } from "@/lib/codes";
import { nextGarmentCodeBlock } from "@/lib/sequence";
import { categoryPrefix } from "@/lib/garment-categories";
import { buildPipeline, garmentStatusFor, STAGE_ORDER } from "@/lib/workflow";
import type { Prisma } from "@/generated/prisma/client";
import type {
  GarmentStatus,
  OrderStatus,
  ProcessingStage,
  TaskStatus,
  TrackingCategory,
} from "@/generated/prisma/enums";

type Tx = Prisma.TransactionClient;

export interface GarmentSeed {
  orderItemId: string;
  garmentTypeId: string;
  trackingCategory: TrackingCategory;
  serviceId: string;
  serviceStages: ProcessingStage[];
  color?: string | null;
  brand?: string | null;
  size?: string | null;
  fabric?: string | null;
  stainNotes?: string | null;
  damageNotes?: string | null;
}

export interface ActorContext {
  userId: string;
  userName: string;
  branchId: string;
  firmId: string;
}

/**
 * Creates one tracked garment per piece, with its QR/barcode identity, its
 * processing pipeline, and the opening entry of its immutable history.
 */
export async function createGarments(
  tx: Tx,
  params: {
    orderId: string;
    branchId: string;
    seeds: GarmentSeed[];
    actor: ActorContext;
  },
): Promise<string[]> {
  const { seeds } = params;
  if (seeds.length === 0) return [];

  // Codes are allocated per category so the prefix on a tag always matches the
  // garment: one block per category rather than one per piece.
  const perCategory = new Map<TrackingCategory, number>();
  for (const seed of seeds) {
    perCategory.set(seed.trackingCategory, (perCategory.get(seed.trackingCategory) ?? 0) + 1);
  }

  const pools = new Map<TrackingCategory, string[]>();
  for (const [category, count] of perCategory) {
    pools.set(category, await nextGarmentCodeBlock(categoryPrefix(category), count, tx));
  }

  const createdIds: string[] = [];

  for (const seed of seeds) {
    const code = pools.get(seed.trackingCategory)!.shift()!;
    const pipeline = buildPipeline(seed.serviceStages);

    const garment = await tx.garment.create({
      data: {
        garmentCode: code,
        qrPayload: buildQrPayload(code),
        barcodeValue: buildBarcodeValue(code),
        orderId: params.orderId,
        orderItemId: seed.orderItemId,
        garmentTypeId: seed.garmentTypeId,
        trackingCategory: seed.trackingCategory,
        serviceId: seed.serviceId,
        branchId: params.branchId,
        firmId: params.actor.firmId,
        status: "RECEIVED",
        currentStage: "RECEIVING",
        color: seed.color ?? null,
        brand: seed.brand ?? null,
        size: seed.size ?? null,
        fabric: seed.fabric ?? null,
        stainNotes: seed.stainNotes ?? null,
        damageNotes: seed.damageNotes ?? null,
        statusHistory: {
          create: {
            toStatus: "RECEIVED",
            stage: "RECEIVING",
            branchId: params.branchId,
            userId: params.actor.userId,
            userName: params.actor.userName,
            note: "Garment received at counter",
          },
        },
        tasks: {
          create: pipeline.map((stage, sequence) => ({
            stage,
            sequence,
            status: "PENDING" as TaskStatus,
            branchId: params.branchId,
          })),
        },
      },
      select: { id: true },
    });

    createdIds.push(garment.id);
  }

  return createdIds;
}

/** Appends to the immutable garment ledger and updates the garment snapshot. */
export async function recordGarmentStatus(
  tx: Tx,
  params: {
    garmentId: string;
    fromStatus: GarmentStatus | null;
    toStatus: GarmentStatus;
    stage: ProcessingStage;
    actor: ActorContext;
    note?: string | null;
    scannedVia?: string | null;
    extraData?: Prisma.GarmentUncheckedUpdateInput;
  },
): Promise<void> {
  await tx.garmentStatusHistory.create({
    data: {
      garmentId: params.garmentId,
      fromStatus: params.fromStatus,
      toStatus: params.toStatus,
      stage: params.stage,
      branchId: params.actor.branchId,
      userId: params.actor.userId,
      userName: params.actor.userName,
      note: params.note ?? null,
      scannedVia: params.scannedVia ?? null,
    },
  });

  await tx.garment.update({
    where: { id: params.garmentId },
    data: {
      status: params.toStatus,
      currentStage: params.stage,
      lastScannedAt: new Date(),
      lastScannedById: params.actor.userId,
      ...params.extraData,
    },
  });
}

/** Stage → the order status a customer would be told. */
const ORDER_STATUS_FOR_STAGE: Record<ProcessingStage, OrderStatus> = {
  RECEIVING: "RECEIVED",
  SORTING: "SORTING",
  WASHING: "WASHING",
  DRYING: "DRYING",
  IRONING: "IRONING",
  QUALITY_CHECK: "QUALITY_CHECK",
  PACKING: "PACKING",
  DISPATCH: "OUT_FOR_DELIVERY",
};

const DONE_TASK_STATUSES: TaskStatus[] = ["COMPLETED", "PASSED", "SKIPPED"];

/**
 * An order is only as far along as its least-advanced garment, and a garment's
 * position is the station it is *waiting at* — not the last one it cleared.
 * Recomputing from the garments keeps the order header honest without
 * duplicating state.
 */
export async function recomputeOrderStatus(
  tx: Tx,
  orderId: string,
  actor: ActorContext,
): Promise<OrderStatus | null> {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: { id: true, status: true, readyAt: true, deliveredAt: true },
  });
  if (!order) return null;

  // Manual and terminal states are never overwritten by shop-floor activity.
  if (
    order.status === "CANCELLED" ||
    order.status === "REFUNDED" ||
    order.status === "ON_HOLD"
  ) {
    return order.status;
  }

  const garments = await tx.garment.findMany({
    where: { orderId },
    select: {
      status: true,
      currentStage: true,
      tasks: {
        select: { stage: true, sequence: true, status: true },
        orderBy: { sequence: "asc" },
      },
    },
  });

  if (garments.length === 0) return order.status;

  const trackable = garments.filter(
    (garment) => garment.status !== "LOST" && garment.status !== "DAMAGED",
  );
  const pool = trackable.length > 0 ? trackable : garments;

  const allDelivered = pool.every((garment) => garment.status === "DELIVERED");
  const someDelivered = pool.some((garment) => garment.status === "DELIVERED");
  const anyOut = pool.some((garment) => garment.status === "OUT_FOR_DELIVERY");
  const allPacked = pool.every((garment) =>
    ["PACKED", "READY", "OUT_FOR_DELIVERY", "DELIVERED"].includes(garment.status),
  );

  let nextStatus: OrderStatus;

  if (allDelivered) nextStatus = "DELIVERED";
  else if (someDelivered) nextStatus = "PARTIALLY_DELIVERED";
  else if (anyOut) nextStatus = "OUT_FOR_DELIVERY";
  else if (allPacked) nextStatus = "READY";
  else {
    // The station the slowest garment is queued at.
    let slowest: ProcessingStage = "DISPATCH";
    let slowestRank = STAGE_ORDER.length;

    for (const garment of pool) {
      const openTask = garment.tasks.find(
        (task) => !DONE_TASK_STATUSES.includes(task.status),
      );
      const stage = openTask?.stage ?? "DISPATCH";
      const rank = STAGE_ORDER.indexOf(stage);
      if (rank < slowestRank) {
        slowestRank = rank;
        slowest = stage;
      }
    }

    nextStatus =
      pool.every((garment) => garment.status === "RECEIVED") && slowest === "SORTING"
        ? "RECEIVED"
        : ORDER_STATUS_FOR_STAGE[slowest];
  }

  if (nextStatus === order.status) return order.status;

  await tx.order.update({
    where: { id: orderId },
    data: {
      status: nextStatus,
      readyAt:
        nextStatus === "READY" && !order.readyAt ? new Date() : order.readyAt,
      deliveredAt:
        nextStatus === "DELIVERED" && !order.deliveredAt
          ? new Date()
          : order.deliveredAt,
    },
  });

  await tx.orderStatusHistory.create({
    data: {
      orderId,
      fromStatus: order.status,
      toStatus: nextStatus,
      userId: actor.userId,
      userName: actor.userName,
      note: "Derived from garment progress",
    },
  });

  return nextStatus;
}

export { STAGE_ORDER, garmentStatusFor, buildPipeline };
