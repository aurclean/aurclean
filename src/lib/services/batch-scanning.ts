import "server-only";

import { prisma } from "@/lib/prisma";
import { parseScan } from "@/lib/codes";
import { categoryMeta } from "@/lib/garment-categories";
import { recordGarmentScan } from "@/lib/services/garment-tracking";
import { advanceGarment } from "@/lib/services/processing";
import type { ProcessingStage, GarmentStatus } from "@/generated/prisma/enums";

export type BatchOutcome = "MATCHED" | "MISMATCH" | "DUPLICATE" | "UNKNOWN";

export interface BatchScanItemResult {
  id: string;
  rawCode: string;
  garmentId: string | null;
  garmentCode: string | null;
  customerName: string | null;
  customerId: string | null;
  orderNumber: string | null;
  orderId: string | null;
  categoryLabel: string | null;
  categoryEmoji: string | null;
  outcome: BatchOutcome;
  status: string | null;
  stage: string | null;
  message: string;
  detail: string | null;
  scannedAt: string;
}

export interface ValidateBatchScanParams {
  rawCode: string;
  operation?: string | null;
  contextOrderId?: string | null;
  contextCustomerId?: string | null;
  autoAdvance?: boolean;
  alreadyScannedCodes?: string[];
  /** Null for a firm-wide operator with no fixed branch — scoped to the
   *  whole firm instead of one branch, same as the main scan workspace. */
  branchIds: string[] | null;
  firmId: string;
  userId: string;
}

const OPERATION_STAGE_MAP: Record<string, { stage: ProcessingStage; targetStatus?: GarmentStatus }> = {
  RECEIVING: { stage: "RECEIVING", targetStatus: "RECEIVED" },
  WASHING: { stage: "WASHING", targetStatus: "WASHED" },
  DRYING: { stage: "DRYING", targetStatus: "DRIED" },
  IRONING: { stage: "IRONING", targetStatus: "IRONED" },
  PACKING: { stage: "PACKING", targetStatus: "PACKED" },
  READY: { stage: "PACKING", targetStatus: "READY" },
  DELIVERY_PREP: { stage: "DISPATCH", targetStatus: "OUT_FOR_DELIVERY" },
};

/**
 * Rapid validation engine for Batch Scanning.
 * Validates existence, QR code, customer/order context, operation expectations, duplicate scans, and inactive status.
 */
export async function validateBatchScan(params: ValidateBatchScanParams): Promise<BatchScanItemResult> {
  const code = params.rawCode.trim();
  const nowStr = new Date().toISOString();
  const scanId = `batch_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  if (!code) {
    return {
      id: scanId,
      rawCode: "",
      garmentId: null,
      garmentCode: null,
      customerName: null,
      customerId: null,
      orderNumber: null,
      orderId: null,
      categoryLabel: null,
      categoryEmoji: null,
      outcome: "UNKNOWN",
      status: null,
      stage: null,
      message: "Empty scan code",
      detail: "No text was captured from scanner",
      scannedAt: nowStr,
    };
  }

  const parsed = parseScan(code);
  const branchWhere = params.branchIds
    ? { branchId: { in: params.branchIds }, firmId: params.firmId }
    : { firmId: params.firmId };

  // 1. Find garment by garmentCode, barcodeValue, qrPayload, or order number
  let garment = await prisma.garment.findFirst({
    where: {
      ...branchWhere,
      OR: [
        { garmentCode: parsed.value },
        { barcodeValue: parsed.value },
        { qrPayload: code },
      ],
    },
    include: {
      order: {
        select: {
          id: true,
          orderNumber: true,
          status: true,
          customerId: true,
          customerName: true,
          customerPhone: true,
        },
      },
    },
  });

  if (!garment && (parsed.kind === "order" || parsed.kind === "unknown")) {
    const order = await prisma.order.findFirst({
      where: { ...branchWhere, orderNumber: { equals: parsed.value, mode: "insensitive" } },
      select: { id: true },
    });
    if (order) {
      garment = await prisma.garment.findFirst({
        where: { orderId: order.id, status: { notIn: ["DELIVERED", "LOST"] } },
        orderBy: { garmentCode: "asc" },
        include: {
          order: {
            select: {
              id: true,
              orderNumber: true,
              status: true,
              customerId: true,
              customerName: true,
              customerPhone: true,
            },
          },
        },
      });
    }
  }

  // If garment does not exist in DB:
  if (!garment) {
    return {
      id: scanId,
      rawCode: code,
      garmentId: null,
      garmentCode: null,
      customerName: null,
      customerId: null,
      orderNumber: null,
      orderId: null,
      categoryLabel: null,
      categoryEmoji: null,
      outcome: "UNKNOWN",
      status: null,
      stage: null,
      message: `Unknown Tag: ${code}`,
      detail: "QR / Barcode does not exist in system database",
      scannedAt: nowStr,
    };
  }

  const catMeta = categoryMeta(garment.trackingCategory);

  // 2. Check for DUPLICATE scan in current batch list
  if (params.alreadyScannedCodes && params.alreadyScannedCodes.includes(garment.garmentCode)) {
    return {
      id: scanId,
      rawCode: code,
      garmentId: garment.id,
      garmentCode: garment.garmentCode,
      customerName: garment.order.customerName,
      customerId: garment.order.customerId,
      orderNumber: garment.order.orderNumber,
      orderId: garment.order.id,
      categoryLabel: catMeta.label,
      categoryEmoji: catMeta.emoji,
      outcome: "DUPLICATE",
      status: garment.status,
      stage: garment.currentStage,
      message: `${garment.garmentCode} — Duplicate Scan`,
      detail: `Already scanned in this batch session`,
      scannedAt: nowStr,
    };
  }

  // 3. MISMATCH Checks
  // Check A: Order mismatch
  if (params.contextOrderId && params.contextOrderId !== garment.orderId) {
    return {
      id: scanId,
      rawCode: code,
      garmentId: garment.id,
      garmentCode: garment.garmentCode,
      customerName: garment.order.customerName,
      customerId: garment.order.customerId,
      orderNumber: garment.order.orderNumber,
      orderId: garment.order.id,
      categoryLabel: catMeta.label,
      categoryEmoji: catMeta.emoji,
      outcome: "MISMATCH",
      status: garment.status,
      stage: garment.currentStage,
      message: `${garment.garmentCode} — Wrong Order Mismatch`,
      detail: `Belongs to ${garment.order.orderNumber} (${garment.order.customerName}), not current batch order`,
      scannedAt: nowStr,
    };
  }

  // Check B: Customer mismatch
  if (params.contextCustomerId && garment.order.customerId && params.contextCustomerId !== garment.order.customerId) {
    return {
      id: scanId,
      rawCode: code,
      garmentId: garment.id,
      garmentCode: garment.garmentCode,
      customerName: garment.order.customerName,
      customerId: garment.order.customerId,
      orderNumber: garment.order.orderNumber,
      orderId: garment.order.id,
      categoryLabel: catMeta.label,
      categoryEmoji: catMeta.emoji,
      outcome: "MISMATCH",
      status: garment.status,
      stage: garment.currentStage,
      message: `${garment.garmentCode} — Wrong Customer Mismatch`,
      detail: `Belongs to ${garment.order.customerName}, not current batch customer`,
      scannedAt: nowStr,
    };
  }

  // Check C: Inactive or Cancelled / Refunded order
  if (garment.order.status === "CANCELLED" || garment.order.status === "REFUNDED") {
    return {
      id: scanId,
      rawCode: code,
      garmentId: garment.id,
      garmentCode: garment.garmentCode,
      customerName: garment.order.customerName,
      customerId: garment.order.customerId,
      orderNumber: garment.order.orderNumber,
      orderId: garment.order.id,
      categoryLabel: catMeta.label,
      categoryEmoji: catMeta.emoji,
      outcome: "MISMATCH",
      status: garment.status,
      stage: garment.currentStage,
      message: `${garment.garmentCode} — Order ${garment.order.status}`,
      detail: `Order ${garment.order.orderNumber} was ${garment.order.status.toLowerCase()}`,
      scannedAt: nowStr,
    };
  }

  // Check D: Already delivered
  if (garment.status === "DELIVERED") {
    return {
      id: scanId,
      rawCode: code,
      garmentId: garment.id,
      garmentCode: garment.garmentCode,
      customerName: garment.order.customerName,
      customerId: garment.order.customerId,
      orderNumber: garment.order.orderNumber,
      orderId: garment.order.id,
      categoryLabel: catMeta.label,
      categoryEmoji: catMeta.emoji,
      outcome: "MISMATCH",
      status: garment.status,
      stage: garment.currentStage,
      message: `${garment.garmentCode} — Already Delivered`,
      detail: `Garment has already been delivered to customer`,
      scannedAt: nowStr,
    };
  }

  // Check E: Operation validation if specific operation is selected
  let operationStage: ProcessingStage | undefined = undefined;
  if (params.operation && OPERATION_STAGE_MAP[params.operation]) {
    operationStage = OPERATION_STAGE_MAP[params.operation].stage;
  }

  // 4. Clean MATCHED scan logic
  // Record scan in GarmentScan ledger, attributed to the garment's own
  // branch — correct whether the operator is scoped to one branch or, for
  // a firm-wide admin, acting across all of them.
  await recordGarmentScan(prisma, {
    garmentId: garment.id,
    stage: operationStage ?? garment.currentStage,
    branchId: garment.branchId,
    userId: params.userId,
    contextOrderId: params.contextOrderId ?? garment.orderId,
    note: params.operation ? `Batch scan (${params.operation})` : "Batch scan",
  });

  let currentStatus: string = garment.status;
  let currentStage: string = garment.currentStage;

  // Auto advance if option enabled and operation provided
  if (params.autoAdvance && params.operation) {
    try {
      const stageConfig = OPERATION_STAGE_MAP[params.operation];
      if (stageConfig) {
        const advResult = await advanceGarment({
          garmentId: garment.id,
          stage: stageConfig.stage,
          outcome: "COMPLETED",
          scannedVia: `batch-${params.operation.toLowerCase()}`,
          actor: { userId: params.userId, userName: "Batch Scanner", branchId: garment.branchId, firmId: garment.firmId },
        });
        currentStatus = advResult.status;
        if (advResult.nextStage) currentStage = advResult.nextStage;
      }
    } catch {
      // If stage advance fails, scan still recorded as matched
    }
  }

  await prisma.garment.update({
    where: { id: garment.id },
    data: { lastScannedAt: new Date(), lastScannedById: params.userId },
  });

  return {
    id: scanId,
    rawCode: code,
    garmentId: garment.id,
    garmentCode: garment.garmentCode,
    customerName: garment.order.customerName,
    customerId: garment.order.customerId,
    orderNumber: garment.order.orderNumber,
    orderId: garment.order.id,
    categoryLabel: catMeta.label,
    categoryEmoji: catMeta.emoji,
    outcome: "MATCHED",
    status: currentStatus,
    stage: currentStage,
    message: `${garment.garmentCode} — ${garment.order.customerName}`,
    detail: `${garment.order.orderNumber} (${catMeta.label})`,
    scannedAt: nowStr,
  };
}

export interface ExpectedGarment {
  garmentId: string;
  garmentCode: string;
  categoryLabel: string;
  categoryEmoji: string;
  orderNumber: string;
  customerName: string;
  status: string;
}

/**
 * Gets expected garments for an order or customer to enable exact reconciliation during batch scanning.
 */
export async function fetchExpectedGarments(params: {
  orderId?: string | null;
  customerId?: string | null;
  branchIds: string[] | null;
  firmId: string;
}): Promise<ExpectedGarment[]> {
  if (!params.orderId && !params.customerId) return [];

  const branchWhere = params.branchIds
    ? { branchId: { in: params.branchIds }, firmId: params.firmId }
    : { firmId: params.firmId };

  const garments = await prisma.garment.findMany({
    where: {
      ...branchWhere,
      ...(params.orderId ? { orderId: params.orderId } : {}),
      ...(params.customerId ? { order: { customerId: params.customerId } } : {}),
      status: { notIn: ["DELIVERED", "LOST", "DAMAGED", "RETURNED"] },
    },
    include: {
      order: { select: { orderNumber: true, customerName: true } },
    },
    orderBy: { garmentCode: "asc" },
  });

  return garments.map((g) => {
    const cat = categoryMeta(g.trackingCategory);
    return {
      garmentId: g.id,
      garmentCode: g.garmentCode,
      categoryLabel: cat.label,
      categoryEmoji: cat.emoji,
      orderNumber: g.order.orderNumber,
      customerName: g.order.customerName,
      status: g.status,
    };
  });
}
