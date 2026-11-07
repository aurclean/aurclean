"use server";

import { revalidatePath } from "next/cache";

import { revalidateOperational } from "@/lib/revalidate";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { PERMISSIONS } from "@/lib/rbac";
import { assertBranchAccess, assertFirmAccess, authorize, requireFirmId } from "@/lib/session";
import {
  BusinessRuleError,
  NotFoundError,
  runAction,
  type ActionResult,
} from "@/lib/action-result";
import { cuidSchema } from "@/lib/validations/common";
import { recordGarmentScan } from "@/lib/services/garment-tracking";

const garmentRef = z.object({ garmentId: cuidSchema });

async function loadGarment(garmentId: string) {
  const garment = await prisma.garment.findUnique({
    where: { id: garmentId },
    select: {
      id: true,
      garmentCode: true,
      branchId: true,
      firmId: true,
      status: true,
      currentStage: true,
      trackingCategory: true,
      orderId: true,
      order: { select: { orderNumber: true } },
      tasks: { select: { stage: true, status: true } },
      scans: { select: { stage: true, outcome: true } },
    },
  });
  if (!garment) throw new NotFoundError("Garment not found");
  return garment;
}

/** "Report Missing" — the one finding that has to survive a page refresh. */
export async function reportMissingAction(payload: unknown): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize(PERMISSIONS.TRACKING_RESOLVE);
    const { garmentId, detail } = garmentRef
      .extend({ detail: z.string().trim().max(500).optional() })
      .parse(payload);

    const garment = await loadGarment(garmentId);
    assertBranchAccess(user, garment.branchId);
    assertFirmAccess(user, garment.firmId);

    await prisma.$transaction(async (tx) => {
      await tx.garment.update({
        where: { id: garment.id },
        data: { status: "LOST" },
      });
      await tx.garmentException.create({
        data: {
          garmentId: garment.id,
          branchId: garment.branchId,
          type: "MISSING",
          detail:
            detail ??
            `Reported missing at ${garment.currentStage.replace(/_/g, " ").toLowerCase()}`,
          reportedById: user.id,
        },
      });
      await tx.garmentStatusHistory.create({
        data: {
          garmentId: garment.id,
          fromStatus: garment.status,
          toStatus: "LOST",
          stage: garment.currentStage,
          branchId: garment.branchId,
          userId: user.id,
          userName: user.name,
          note: "Reported missing from the mismatch centre",
        },
      });
    });

    await recordAudit({
      userId: user.id,
      branchId: garment.branchId,
      action: "GARMENT_REPORTED_MISSING",
      entity: "Garment",
      entityId: garment.id,
      summary: `${garment.garmentCode} on ${garment.order.orderNumber} reported missing`,
    });

    revalidateOperational();
    return null;
  });
}

/**
 * "Scan Again" — records a fresh clean read at the garment's current station,
 * which is what clears a not-scanned or duplicate finding.
 */
export async function rescanGarmentAction(payload: unknown): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize(PERMISSIONS.GARMENT_SCAN);
    const { garmentId } = garmentRef.parse(payload);

    const garment = await loadGarment(garmentId);
    assertBranchAccess(user, garment.branchId);
    assertFirmAccess(user, garment.firmId);

    if (garment.status === "LOST") {
      throw new BusinessRuleError(
        `${garment.garmentCode} is reported missing — recover it first`,
      );
    }

    // The operator has the piece in their hand. That confirms both where it is
    // now and that it did pass the stations it is recorded as having cleared,
    // so the gaps are filled in — marked as reconciled, not as reads that
    // happened at the time.
    const scannedStages = new Set(
      garment.scans.filter((scan) => scan.outcome === "MATCH").map((scan) => scan.stage),
    );
    const unscannedCleared = garment.tasks
      .filter(
        (task) =>
          ["COMPLETED", "PASSED", "SKIPPED"].includes(task.status) &&
          !scannedStages.has(task.stage),
      )
      .map((task) => task.stage);

    await prisma.$transaction(async (tx) => {
      await tx.garmentScan.deleteMany({
        where: {
          garmentId: garment.id,
          outcome: { in: ["WRONG_ORDER", "WRONG_CATEGORY", "DUPLICATE"] },
        },
      });

      for (const stage of unscannedCleared) {
        await tx.garmentScan.create({
          data: {
            garmentId: garment.id,
            orderId: garment.orderId,
            contextOrderId: garment.orderId,
            branchId: garment.branchId,
            trackingCategory: garment.trackingCategory,
            stage,
            outcome: "MATCH",
            note: "Reconciled at the mismatch centre",
            scannedById: user.id,
          },
        });
      }

      await recordGarmentScan(tx, {
        garmentId: garment.id,
        stage: garment.currentStage,
        branchId: garment.branchId,
        userId: user.id,
        contextOrderId: garment.orderId,
        note: "Re-scanned from the mismatch centre",
      });
      await tx.garment.update({
        where: { id: garment.id },
        data: { lastScannedAt: new Date(), lastScannedById: user.id },
      });
      await tx.garmentException.updateMany({
        where: {
          garmentId: garment.id,
          status: "OPEN",
          type: { in: ["NOT_SCANNED", "DUPLICATE_SCAN", "WRONG_ORDER"] },
        },
        data: {
          status: "RESOLVED",
          resolvedAt: new Date(),
          resolvedById: user.id,
          resolution: "Confirmed by a fresh scan",
        },
      });
    });

    await recordAudit({
      userId: user.id,
      branchId: garment.branchId,
      action: "GARMENT_RESCANNED",
      entity: "Garment",
      entityId: garment.id,
      summary: `${garment.garmentCode} re-scanned at ${garment.currentStage}`,
    });

    revalidateOperational();
    return null;
  });
}

/**
 * "Correct Order" — reassigns a garment that was booked against the wrong
 * order. Both orders' piece counts and statuses are re-derived afterwards.
 */
export async function correctOrderAction(payload: unknown): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize(PERMISSIONS.ORDER_UPDATE);
    const { garmentId, orderNumber } = garmentRef
      .extend({ orderNumber: z.string().trim().min(3).max(40) })
      .parse(payload);

    const garment = await loadGarment(garmentId);
    assertBranchAccess(user, garment.branchId);
    assertFirmAccess(user, garment.firmId);

    const target = await prisma.order.findFirst({
      where: { orderNumber: { equals: orderNumber, mode: "insensitive" }, firmId: requireFirmId(user) },
      select: { id: true, orderNumber: true, branchId: true, status: true },
    });
    if (!target) throw new NotFoundError(`No order matches ${orderNumber}`);
    assertBranchAccess(user, target.branchId);

    if (target.id === garment.orderId) {
      throw new BusinessRuleError(
        `${garment.garmentCode} already belongs to ${target.orderNumber}`,
      );
    }
    if (["DELIVERED", "CANCELLED", "REFUNDED"].includes(target.status)) {
      throw new BusinessRuleError(`${target.orderNumber} is closed`);
    }

    const previousOrderId = garment.orderId;

    await prisma.$transaction(async (tx) => {
      await tx.garment.update({
        where: { id: garment.id },
        data: {
          orderId: target.id,
          // The line item belonged to the old order, so the link is dropped
          // rather than pointed at something that does not describe it.
          orderItemId: null,
        },
      });
      await tx.garmentScan.updateMany({
        where: { garmentId: garment.id },
        data: { orderId: target.id, outcome: "MATCH" },
      });
      await tx.garmentException.updateMany({
        where: {
          garmentId: garment.id,
          status: "OPEN",
          type: { in: ["WRONG_ORDER", "WRONG_GARMENT"] },
        },
        data: {
          status: "RESOLVED",
          resolvedAt: new Date(),
          resolvedById: user.id,
          resolution: `Reassigned to ${target.orderNumber}`,
        },
      });
      await tx.garmentStatusHistory.create({
        data: {
          garmentId: garment.id,
          fromStatus: garment.status,
          toStatus: garment.status,
          stage: garment.currentStage,
          branchId: garment.branchId,
          userId: user.id,
          userName: user.name,
          note: `Reassigned from ${garment.order.orderNumber} to ${target.orderNumber}`,
        },
      });

      for (const orderId of [previousOrderId, target.id]) {
        const pieces = await tx.garment.count({ where: { orderId } });
        await tx.order.update({ where: { id: orderId }, data: { totalPieces: pieces } });
      }
    });

    await recordAudit({
      userId: user.id,
      branchId: garment.branchId,
      action: "GARMENT_REASSIGNED",
      entity: "Garment",
      entityId: garment.id,
      summary: `${garment.garmentCode} moved from ${garment.order.orderNumber} to ${target.orderNumber}`,
    });

    revalidateOperational([`/orders/${previousOrderId}`, `/orders/${target.id}`]);
    return null;
  });
}

/** Close a finding a person has looked at and judged fine. */
export async function dismissMismatchAction(payload: unknown): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize(PERMISSIONS.TRACKING_RESOLVE);
    const { garmentId, reason } = garmentRef
      .extend({ reason: z.string().trim().max(300).optional() })
      .parse(payload);

    const garment = await loadGarment(garmentId);
    assertBranchAccess(user, garment.branchId);
    assertFirmAccess(user, garment.firmId);

    await prisma.garmentException.updateMany({
      where: { garmentId: garment.id, status: "OPEN" },
      data: {
        status: "DISMISSED",
        resolvedAt: new Date(),
        resolvedById: user.id,
        resolution: reason ?? "Checked and no action needed",
      },
    });

    revalidateOperational();
    return null;
  });
}
