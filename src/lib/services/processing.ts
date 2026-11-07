import "server-only";
import { prisma } from "@/lib/prisma";
import { BusinessRuleError, NotFoundError } from "@/lib/action-result";
import {
  garmentStatusFor,
  STAGE_ORDER,
  STAGE_OUTCOMES,
} from "@/lib/workflow";
import {
  recomputeOrderStatus,
  recordGarmentStatus,
  type ActorContext,
} from "@/lib/services/garments";
import { recordGarmentScan } from "@/lib/services/garment-tracking";
import { notify } from "@/lib/services/notifications";
import { formatCurrency } from "@/lib/money";
import type {
  GarmentScanOutcome,
  ProcessingStage,
  TaskStatus,
  TrackingCategory,
} from "@/generated/prisma/enums";

export interface AdvanceInput {
  garmentId: string;
  stage: ProcessingStage;
  outcome: TaskStatus;
  actor: ActorContext;
  note?: string | null;
  scannedVia?: string | null;
  /** The order the operator had open, so a wrong-order read is caught here. */
  contextOrderId?: string | null;
  /** The bucket the station is working, so a stray category is caught too. */
  expectedCategory?: TrackingCategory | null;
}

export interface AdvanceResult {
  garmentCode: string;
  orderNumber: string;
  status: string;
  stage: ProcessingStage;
  nextStage: ProcessingStage | null;
  orderStatus: string | null;
  /** How the scan that moved this garment classified. */
  scanOutcome: GarmentScanOutcome;
  /** Set when the scan was anything but clean — show it to the operator. */
  mismatchAlert: string | null;
}

/**
 * The single entry point for every workstation. Records the task transition,
 * appends to the garment's immutable history, opens the next stage, and
 * re-derives the parent order's status — all inside one transaction.
 */
export async function advanceGarment(input: AdvanceInput): Promise<AdvanceResult> {
  const allowed = STAGE_OUTCOMES[input.stage] ?? [];
  if (!allowed.includes(input.outcome)) {
    throw new BusinessRuleError(
      `"${input.outcome}" is not a valid outcome for the ${input.stage} station`,
    );
  }

  let orderJustBecameReady = false;

  const result = await prisma.$transaction(async (tx) => {
    const garment = await tx.garment.findUnique({
      where: { id: input.garmentId },
      include: {
        order: { select: { id: true, orderNumber: true, status: true } },
        tasks: { orderBy: { sequence: "asc" } },
      },
    });

    if (!garment) throw new NotFoundError("Garment not found");
    if (garment.firmId !== input.actor.firmId) throw new NotFoundError("Garment not found");
    if (garment.branchId !== input.actor.branchId) {
      throw new BusinessRuleError(
        "This garment belongs to another branch and cannot be processed here",
      );
    }
    if (["DELIVERED", "LOST"].includes(garment.status)) {
      throw new BusinessRuleError(
        `Garment ${garment.garmentCode} is already ${garment.status.toLowerCase()}`,
      );
    }

    const task = garment.tasks.find((t) => t.stage === input.stage);
    if (!task) {
      throw new BusinessRuleError(
        `Garment ${garment.garmentCode} does not pass through the ${input.stage} stage`,
      );
    }

    // A garment may not jump a station: every earlier stage must be finished.
    const earlierOpen = garment.tasks.find(
      (t) =>
        t.sequence < task.sequence &&
        !["COMPLETED", "PASSED", "SKIPPED"].includes(t.status),
    );
    if (earlierOpen && input.outcome !== "IN_PROGRESS") {
      throw new BusinessRuleError(
        `${STAGE_ORDER.includes(earlierOpen.stage) ? earlierOpen.stage.replace("_", " ").toLowerCase() : "an earlier stage"} is still pending for ${garment.garmentCode}`,
      );
    }

    const now = new Date();
    const isTerminalOutcome = ["COMPLETED", "PASSED"].includes(input.outcome);
    const isRemediation = ["FAILED", "REWASH", "REWORK"].includes(input.outcome);

    const startedAt = task.startedAt ?? (input.outcome === "IN_PROGRESS" ? now : now);
    const durationSeconds = isTerminalOutcome
      ? Math.max(0, Math.round((now.getTime() - startedAt.getTime()) / 1000))
      : null;

    await tx.processingTask.update({
      where: { id: task.id },
      data: {
        status: input.outcome,
        assignedToId: task.assignedToId ?? input.actor.userId,
        startedAt: task.startedAt ?? startedAt,
        completedAt: isTerminalOutcome ? now : null,
        durationSeconds,
        failureReason: isRemediation ? (input.note ?? "Failed at station") : null,
        notes: input.note ?? task.notes,
        history: {
          create: {
            fromStatus: task.status,
            toStatus: input.outcome,
            userId: input.actor.userId,
            userName: input.actor.userName,
            note: input.note ?? null,
          },
        },
      },
    });

    let effectiveStage = input.stage;
    let garmentStatus = garmentStatusFor(input.stage, input.outcome);

    if (isRemediation) {
      // Send the garment back to the station that can fix it and reopen every
      // stage downstream of it.
      const target: ProcessingStage =
        input.stage === "QUALITY_CHECK"
          ? "WASHING"
          : input.stage;

      const targetTask =
        garment.tasks.find((t) => t.stage === target) ??
        garment.tasks.find((t) => t.stage === input.stage)!;

      await tx.processingTask.updateMany({
        where: {
          garmentId: garment.id,
          sequence: { gte: targetTask.sequence },
        },
        data: {
          status: "PENDING",
          startedAt: null,
          completedAt: null,
          durationSeconds: null,
        },
      });

      effectiveStage = targetTask.stage;
      garmentStatus = input.stage === "IRONING" ? "REWORK" : "REWASH";

      await tx.garment.update({
        where: { id: garment.id },
        data:
          input.stage === "IRONING"
            ? { reworkCount: { increment: 1 } }
            : { rewashCount: { increment: 1 } },
      });
    } else if (isTerminalOutcome) {
      const next = garment.tasks.find((t) => t.sequence === task.sequence + 1);
      if (next) {
        await tx.processingTask.update({
          where: { id: next.id },
          data: { status: "PENDING" },
        });
      }
    }

    // Every station move is a scan, and the scan is what the mismatch centre
    // reads. Recorded before the status change so a wrong-order read is still
    // on the ledger even though the move itself is allowed to stand.
    const scan = await recordGarmentScan(tx, {
      garmentId: garment.id,
      stage: input.stage,
      branchId: input.actor.branchId,
      userId: input.actor.userId,
      contextOrderId: input.contextOrderId ?? null,
      expectedCategory: input.expectedCategory ?? null,
      location: input.scannedVia ?? null,
      note: input.note ?? null,
    });

    await recordGarmentStatus(tx, {
      garmentId: garment.id,
      fromStatus: garment.status,
      toStatus: garmentStatus,
      stage: effectiveStage,
      actor: input.actor,
      note: input.note ?? null,
      scannedVia: input.scannedVia ?? null,
    });

    const orderStatus = await recomputeOrderStatus(
      tx,
      garment.orderId,
      input.actor,
    );
    orderJustBecameReady = orderStatus === "READY" && garment.order.status !== "READY";

    const nextTask = garment.tasks.find((t) => t.sequence === task.sequence + 1);

    return {
      garmentCode: garment.garmentCode,
      orderNumber: garment.order.orderNumber,
      orderId: garment.orderId,
      status: garmentStatus,
      stage: effectiveStage,
      nextStage: isTerminalOutcome ? (nextTask?.stage ?? null) : input.stage,
      orderStatus: orderStatus ?? null,
      scanOutcome: scan.outcome,
      mismatchAlert: scan.alert,
    };
  });

  // Fired after commit, from the one place every station and the batch
  // scanner's auto-advance both funnel through — so a garment's own scan
  // reaching the last station notifies the customer exactly like a manual
  // "Move status → Ready" already did, with no separate wiring per screen.
  if (orderJustBecameReady) {
    const order = await prisma.order.findUnique({
      where: { id: result.orderId },
      select: {
        customerName: true,
        customerPhone: true,
        customerEmail: true,
        outstandingAmount: true,
      },
    });
    if (order) {
      await notify({
        event: "ORDER_READY",
        orderId: result.orderId,
        branchId: input.actor.branchId,
        recipientName: order.customerName,
        recipientPhone: order.customerPhone,
        recipientEmail: order.customerEmail,
        variables: {
          customerName: order.customerName,
          orderNumber: result.orderNumber,
          outstanding: formatCurrency(order.outstandingAmount),
        },
      });
    }
  }

  return result;
}

/** Bulk variant for "scan a pile and press one button" workflows. */
export async function advanceMany(
  garmentIds: string[],
  params: Omit<AdvanceInput, "garmentId">,
): Promise<{ succeeded: AdvanceResult[]; failed: { garmentId: string; error: string }[] }> {
  const succeeded: AdvanceResult[] = [];
  const failed: { garmentId: string; error: string }[] = [];

  for (const garmentId of garmentIds) {
    try {
      succeeded.push(await advanceGarment({ ...params, garmentId }));
    } catch (error) {
      failed.push({
        garmentId,
        error: error instanceof Error ? error.message : "Failed",
      });
    }
  }

  return { succeeded, failed };
}

/** Counts for the workstation queue tabs. */
export async function stageCounts(stage: ProcessingStage, branchId?: string) {
  const grouped = await prisma.processingTask.groupBy({
    by: ["status"],
    where: { stage, ...(branchId ? { branchId } : {}) },
    _count: { _all: true },
  });

  return grouped.reduce<Record<string, number>>((acc, row) => {
    acc[row.status] = row._count._all;
    return acc;
  }, {});
}
