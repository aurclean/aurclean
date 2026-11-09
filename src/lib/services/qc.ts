import "server-only";

import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { BusinessRuleError, NotFoundError } from "@/lib/action-result";
import { isGlobalRole } from "@/lib/rbac";
import { requireFirmId, type SessionUser } from "@/lib/session";
import { advanceGarment } from "@/lib/services/processing";
import { recomputeOrderStatus, recordGarmentStatus, type ActorContext } from "@/lib/services/garments";
import type { QCResult } from "@/generated/prisma/enums";

/**
 * QC workflow (per garment):
 *
 *   processing completed → QC pending → QC passed
 *   QC pending → QC failed → rework → (stations again) → QC pending → QC passed
 *
 * Every function is pinned to the caller's firm (and branch, for branch-bound
 * staff) at query level: a garment id from another firm simply is not found.
 */

const garmentSelect = {
  id: true,
  garmentCode: true,
  status: true,
  color: true,
  brand: true,
  reworkCount: true,
  branchId: true,
  garmentType: { select: { name: true } },
  service: { select: { name: true } },
  order: { select: { id: true, orderNumber: true } },
} as const;

function scope(user: SessionUser) {
  return {
    firmId: requireFirmId(user),
    ...(!isGlobalRole(user.role) && user.branchId ? { branchId: user.branchId } : {}),
  };
}

/** Garments whose QC task is open and whose earlier stages are all finished. */
export async function getQcQueue(user: SessionUser) {
  const rows = await prisma.garment.findMany({
    where: {
      ...scope(user),
      status: { notIn: ["DELIVERED", "LOST", "QC_FAILED", "QC_PASSED", "REWORK", "REWASH"] },
      tasks: { some: { stage: "QUALITY_CHECK", status: { in: ["PENDING", "IN_PROGRESS"] } } },
    },
    orderBy: { updatedAt: "asc" },
    take: 200,
    select: { ...garmentSelect, tasks: { select: { stage: true, status: true, sequence: true } } },
  });

  return rows.filter((g) => {
    const qc = g.tasks.find((t) => t.stage === "QUALITY_CHECK")!;
    return g.tasks
      .filter((t) => t.sequence < qc.sequence)
      .every((t) => ["COMPLETED", "PASSED", "SKIPPED"].includes(t.status));
  });
}

/** Garments needing attention after a failed inspection (failed, or already sent for rework). */
export async function getFailedOrRework(user: SessionUser) {
  return prisma.garment.findMany({
    where: { ...scope(user), status: { in: ["QC_FAILED", "REWORK"] } },
    orderBy: { updatedAt: "desc" },
    take: 200,
    select: { ...garmentSelect, qcRecords: { orderBy: { createdAt: "desc" }, take: 1, select: { notes: true, result: true } } },
  });
}

export async function getQcHistory(user: SessionUser, result: QCResult, take = 100) {
  return prisma.qCRecord.findMany({
    where: { firmId: requireFirmId(user), result, ...(!isGlobalRole(user.role) && user.branchId ? { branchId: user.branchId } : {}) },
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true, notes: true, createdAt: true,
      inspector: { select: { name: true } },
      garment: { select: { garmentCode: true, garmentType: { select: { name: true } } } },
      order: { select: { orderNumber: true } },
    },
  });
}

export type QcDecision = "PASS" | "FAIL" | "REWORK";

export async function recordQcDecision(
  user: SessionUser,
  input: { garmentId: string; decision: QcDecision; notes?: string | null },
) {
  const firmId = requireFirmId(user);
  const notes = input.notes?.trim() || null;

  // Firm- (and branch-) scoped lookup: another firm's garment is "not found".
  const garment = await prisma.garment.findFirst({
    where: { id: input.garmentId, ...scope(user) },
    select: { ...garmentSelect, tasks: { orderBy: { sequence: "asc" }, select: { id: true, stage: true, status: true, sequence: true } } },
  });
  if (!garment) throw new NotFoundError("Garment not found");

  const actor: ActorContext = { userId: user.id, userName: user.name, branchId: garment.branchId, firmId };
  const qcTask = garment.tasks.find((t) => t.stage === "QUALITY_CHECK");
  if (!qcTask) throw new BusinessRuleError(`${garment.garmentCode} does not go through quality control`);

  let result: QCResult;

  if (input.decision === "PASS") {
    if (!["PENDING", "IN_PROGRESS"].includes(qcTask.status)) {
      throw new BusinessRuleError(`${garment.garmentCode} is not waiting for QC`);
    }
    await advanceGarment({ garmentId: garment.id, stage: "QUALITY_CHECK", outcome: "PASSED", actor, note: notes });
    result = "PASSED";
  } else if (input.decision === "FAIL") {
    if (!["PENDING", "IN_PROGRESS"].includes(qcTask.status)) {
      throw new BusinessRuleError(`${garment.garmentCode} is not waiting for QC`);
    }
    if (!notes) throw new BusinessRuleError("Add an inspection note explaining the failure");
    await prisma.$transaction(async (tx) => {
      await tx.processingTask.update({ where: { id: qcTask.id }, data: { status: "FAILED", failureReason: notes, notes } });
      await recordGarmentStatus(tx, {
        garmentId: garment.id,
        fromStatus: garment.status,
        toStatus: "QC_FAILED",
        stage: "QUALITY_CHECK",
        actor,
        note: notes,
      });
      await recomputeOrderStatus(tx, garment.order.id, actor);
    });
    result = "FAILED";
  } else {
    if (garment.status !== "QC_FAILED") throw new BusinessRuleError("Only a garment that failed QC can be sent for rework");
    // Rework restarts at finishing (ironing) when the garment has that stage, otherwise at washing.
    const target = garment.tasks.find((t) => t.stage === "IRONING") ?? garment.tasks.find((t) => t.stage === "WASHING") ?? qcTask;
    await prisma.$transaction(async (tx) => {
      await tx.processingTask.updateMany({
        where: { garmentId: garment.id, sequence: { gte: target.sequence } },
        data: { status: "PENDING", startedAt: null, completedAt: null, durationSeconds: null },
      });
      await tx.garment.update({ where: { id: garment.id }, data: { reworkCount: { increment: 1 } } });
      await recordGarmentStatus(tx, {
        garmentId: garment.id,
        fromStatus: garment.status,
        toStatus: "REWORK",
        stage: target.stage,
        actor,
        note: notes ?? "Sent for rework after failed QC",
      });
      await recomputeOrderStatus(tx, garment.order.id, actor);
    });
    result = "REWORK";
  }

  await prisma.qCRecord.create({
    data: {
      firmId,
      branchId: garment.branchId,
      orderId: garment.order.id,
      garmentId: garment.id,
      inspectorId: user.id,
      result,
      notes,
    },
  });
  await recordAudit({
    userId: user.id,
    firmId,
    branchId: garment.branchId,
    action: `QC_${result}`,
    entity: "Garment",
    entityId: garment.id,
    summary: `${garment.garmentCode} (${garment.order.orderNumber}): QC ${result.toLowerCase()}`,
  });

  return { garmentCode: garment.garmentCode, result };
}
