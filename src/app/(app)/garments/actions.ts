"use server";

import { revalidatePath } from "next/cache";

import { revalidateOperational } from "@/lib/revalidate";

import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { PERMISSIONS, STAGE_PERMISSION } from "@/lib/rbac";
import {
  assertBranchAccess,
  assertFirmAccess,
  authorize,
  hasPermission,
  requireFirmId,
} from "@/lib/session";
import {
  BusinessRuleError,
  NotFoundError,
  runAction,
  type ActionResult,
} from "@/lib/action-result";
import { RATE_LIMITS, rateLimit } from "@/lib/rate-limit";
import { parseScan } from "@/lib/codes";
import { categoryLabel } from "@/lib/garment-categories";
import { advanceGarment, advanceMany } from "@/lib/services/processing";
import { recomputeOrderStatus } from "@/lib/services/garments";
import {
  assertUploadAllowed,
  getStorageProvider,
} from "@/lib/providers/storage";
import {
  advanceStageSchema,
  bulkAdvanceSchema,
  garmentUpdateSchema,
  markGarmentSchema,
} from "@/lib/validations/garment";

export async function advanceGarmentAction(
  payload: unknown,
): Promise<
  ActionResult<{
    garmentCode: string;
    status: string;
    nextStage: string | null;
    mismatchAlert: string | null;
  }>
> {
  return runAction(async () => {
    const input = advanceStageSchema.parse(payload);
    const required = STAGE_PERMISSION[input.stage] ?? PERMISSIONS.PROCESSING_VIEW;
    const user = await authorize(required);
    const firmId = requireFirmId(user);
    const hasAllBranches = hasPermission(user, PERMISSIONS.DASHBOARD_VIEW_ALL_BRANCHES);

    if (!user.branchId && !hasAllBranches) {
      throw new BusinessRuleError("Your account is not assigned to a branch");
    }

    // A firm-wide admin with no fixed branch acts on whichever branch the
    // garment itself belongs to — verified against their own firm first,
    // since advanceGarment's own branch check can't do that for them.
    let actingBranchId = user.branchId;
    if (!actingBranchId) {
      const garment = await prisma.garment.findUnique({
        where: { id: input.garmentId },
        select: { branchId: true, firmId: true },
      });
      if (!garment) throw new NotFoundError("Garment not found");
      assertFirmAccess(user, garment.firmId);
      actingBranchId = garment.branchId;
    }

    const result = await advanceGarment({
      garmentId: input.garmentId,
      stage: input.stage,
      outcome: input.outcome,
      note: input.note ?? null,
      scannedVia: input.scannedVia ?? "manual",
      contextOrderId: input.contextOrderId ?? null,
      actor: { userId: user.id, userName: user.name, branchId: actingBranchId, firmId },
    });

    await recordAudit({
      userId: user.id,
      branchId: actingBranchId,
      action: "GARMENT_STAGE_ADVANCED",
      entity: "Garment",
      entityId: input.garmentId,
      summary: `${result.garmentCode} → ${result.status} at ${input.stage}`,
      after: { stage: input.stage, outcome: input.outcome, note: input.note },
    });

    revalidateOperational([`/garments/${result.garmentCode}`]);

    return {
      garmentCode: result.garmentCode,
      status: result.status,
      nextStage: result.nextStage,
      mismatchAlert: result.mismatchAlert,
    };
  });
}

export async function bulkAdvanceAction(
  payload: unknown,
): Promise<ActionResult<{ succeeded: number; failed: { garmentId: string; error: string }[] }>> {
  return runAction(async () => {
    const input = bulkAdvanceSchema.parse(payload);
    const required = STAGE_PERMISSION[input.stage] ?? PERMISSIONS.PROCESSING_VIEW;
    const user = await authorize(required);
    const firmId = requireFirmId(user);
    const hasAllBranches = hasPermission(user, PERMISSIONS.DASHBOARD_VIEW_ALL_BRANCHES);

    if (!user.branchId && !hasAllBranches) {
      throw new BusinessRuleError("Your account is not assigned to a branch");
    }
    if (input.garmentIds.length > 300) {
      throw new BusinessRuleError("Process at most 300 garments at a time");
    }

    // A firm-wide admin with no fixed branch acts on whichever branch the
    // selected garments belong to (advanceGarment's own per-item firmId
    // check still protects each one individually inside advanceMany).
    let actingBranchId = user.branchId;
    if (!actingBranchId) {
      const first = await prisma.garment.findFirst({
        where: { id: { in: input.garmentIds } },
        select: { branchId: true },
      });
      if (!first) throw new NotFoundError("Garment not found");
      actingBranchId = first.branchId;
    }

    const { succeeded, failed } = await advanceMany(input.garmentIds, {
      stage: input.stage,
      outcome: input.outcome,
      note: input.note ?? null,
      scannedVia: "bulk",
      actor: { userId: user.id, userName: user.name, branchId: actingBranchId, firmId },
    });

    await recordAudit({
      userId: user.id,
      branchId: actingBranchId,
      action: "GARMENT_BULK_ADVANCED",
      entity: "ProcessingTask",
      summary: `${succeeded.length} garments → ${input.outcome} at ${input.stage}${failed.length ? ` (${failed.length} failed)` : ""}`,
    });

    revalidateOperational();

    return { succeeded: succeeded.length, failed };
  });
}

export async function updateGarmentAction(payload: unknown): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize(PERMISSIONS.GARMENT_UPDATE);
    const input = garmentUpdateSchema.parse(payload);

    const garment = await prisma.garment.findUnique({
      where: { id: input.garmentId },
      select: { id: true, branchId: true, firmId: true, garmentCode: true },
    });
    if (!garment) throw new NotFoundError("Garment not found");
    assertBranchAccess(user, garment.branchId);
    assertFirmAccess(user, garment.firmId);

    await prisma.garment.update({
      where: { id: garment.id },
      data: {
        color: input.color ?? null,
        brand: input.brand ?? null,
        size: input.size ?? null,
        fabric: input.fabric ?? null,
        stainNotes: input.stainNotes ?? null,
        damageNotes: input.damageNotes ?? null,
      },
    });

    await recordAudit({
      userId: user.id,
      branchId: garment.branchId,
      action: "GARMENT_UPDATED",
      entity: "Garment",
      entityId: garment.id,
      summary: `Updated details for ${garment.garmentCode}`,
      after: input,
    });

    revalidatePath(`/garments/${garment.garmentCode}`);
    return null;
  });
}

/** Flags a garment as lost, damaged or returned — always with a reason. */
export async function markGarmentAction(payload: unknown): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize(PERMISSIONS.GARMENT_UPDATE);
    const input = markGarmentSchema.parse(payload);

    const garment = await prisma.garment.findUnique({
      where: { id: input.garmentId },
      select: { id: true, firmId: true, branchId: true, garmentCode: true, status: true, orderId: true },
    });
    if (!garment) throw new NotFoundError("Garment not found");
    assertFirmAccess(user, garment.firmId);
    assertBranchAccess(user, garment.branchId);

    await prisma.$transaction(async (tx) => {
      await tx.garment.update({
        where: { id: garment.id },
        data: { status: input.status },
      });
      await tx.garmentStatusHistory.create({
        data: {
          garmentId: garment.id,
          fromStatus: garment.status,
          toStatus: input.status,
          stage: "DISPATCH",
          branchId: garment.branchId,
          userId: user.id,
          userName: user.name,
          note: input.note,
        },
      });
      await tx.processingTask.updateMany({
        where: { garmentId: garment.id, status: { in: ["PENDING", "IN_PROGRESS"] } },
        data: { status: "SKIPPED" },
      });
      await recomputeOrderStatus(tx, garment.orderId, {
        userId: user.id,
        userName: user.name,
        branchId: garment.branchId,
        firmId: garment.firmId,
      });
    });

    await recordAudit({
      userId: user.id,
      branchId: garment.branchId,
      action: `GARMENT_MARKED_${input.status}`,
      entity: "Garment",
      entityId: garment.id,
      summary: `${garment.garmentCode} marked ${input.status.toLowerCase()}: ${input.note}`,
    });

    revalidateOperational([`/garments/${garment.garmentCode}`]);
    return null;
  });
}

/** Uploads an intake or damage photo to object storage. */
export async function uploadGarmentPhotoAction(
  formData: FormData,
): Promise<ActionResult<{ url: string }>> {
  return runAction(async () => {
    const user = await authorize(PERMISSIONS.GARMENT_PHOTO_UPLOAD);

    const limit = rateLimit(
      `upload:${user.id}`,
      RATE_LIMITS.UPLOAD.limit,
      RATE_LIMITS.UPLOAD.windowMs,
    );
    if (!limit.success) throw new BusinessRuleError("Too many uploads — try again shortly");

    const garmentId = String(formData.get("garmentId") ?? "");
    const kind = String(formData.get("kind") ?? "INTAKE");
    const caption = String(formData.get("caption") ?? "").slice(0, 200);
    const file = formData.get("file");

    if (!(file instanceof File)) throw new BusinessRuleError("Choose an image to upload");
    assertUploadAllowed({ type: file.type, size: file.size });

    const garment = await prisma.garment.findUnique({
      where: { id: garmentId },
      select: { id: true, branchId: true, firmId: true, garmentCode: true },
    });
    if (!garment) throw new NotFoundError("Garment not found");
    assertBranchAccess(user, garment.branchId);
    assertFirmAccess(user, garment.firmId);

    const stored = await getStorageProvider().upload({
      body: Buffer.from(await file.arrayBuffer()),
      mimeType: file.type,
      originalName: file.name,
      folder: `garments/${garment.garmentCode}`,
    });

    await prisma.garmentPhoto.create({
      data: {
        garmentId: garment.id,
        url: stored.url,
        storageKey: stored.key,
        mimeType: stored.mimeType,
        sizeBytes: stored.size,
        kind: kind === "DAMAGE" ? "DAMAGE" : kind === "OUTBOUND" ? "OUTBOUND" : "INTAKE",
        caption: caption || null,
        uploadedById: user.id,
      },
    });

    await recordAudit({
      userId: user.id,
      branchId: garment.branchId,
      action: "GARMENT_PHOTO_UPLOADED",
      entity: "Garment",
      entityId: garment.id,
      summary: `Photo added to ${garment.garmentCode}`,
    });

    revalidatePath(`/garments/${garment.garmentCode}`);
    return { url: stored.url };
  });
}

/** Used by workstation screens to confirm a scanned garment belongs there. */
export async function scanForStageAction(
  code: string,
  stage: string,
  contextOrderNumber?: string | null,
): Promise<
  ActionResult<{
    id: string;
    garmentCode: string;
    orderNumber: string;
    typeName: string;
    categoryLabel: string;
    taskStatus: string;
    mismatchAlert: string | null;
  }>
> {
  return runAction(async () => {
    const required = STAGE_PERMISSION[stage] ?? PERMISSIONS.PROCESSING_VIEW;
    const user = await authorize(required);

    const parsed = parseScan(code);
    if (parsed.kind !== "garment") {
      throw new BusinessRuleError("That is not a garment code");
    }

    const garment = await prisma.garment.findUnique({
      where: { garmentCode: parsed.value },
      include: {
        order: { select: { orderNumber: true } },
        garmentType: { select: { name: true } },
        tasks: true,
      },
    });

    if (!garment) throw new NotFoundError(`No garment matches ${parsed.value}`);
    assertBranchAccess(user, garment.branchId);
    assertFirmAccess(user, garment.firmId);

    const task = garment.tasks.find((t) => t.stage === stage);
    if (!task) {
      throw new BusinessRuleError(
        `${garment.garmentCode} does not pass through this station`,
      );
    }
    if (["COMPLETED", "PASSED"].includes(task.status)) {
      throw new BusinessRuleError(
        `${garment.garmentCode} has already cleared this station`,
      );
    }

    // The operator finds out now, while the piece is still in their hand.
    let mismatchAlert: string | null = null;
    if (
      contextOrderNumber &&
      contextOrderNumber.toUpperCase() !== garment.order.orderNumber.toUpperCase()
    ) {
      mismatchAlert = `${garment.garmentCode} belongs to ${garment.order.orderNumber}, not ${contextOrderNumber.toUpperCase()}.`;
    } else {
      const alreadyHere = await prisma.garmentScan.findFirst({
        where: {
          garmentId: garment.id,
          stage: stage as never,
          outcome: "MATCH",
          scannedAt: { gte: new Date(Date.now() - 15 * 60 * 1000) },
        },
        select: { id: true },
      });
      if (alreadyHere) {
        mismatchAlert = `${garment.garmentCode} was already scanned into this station a moment ago.`;
      }
    }

    return {
      id: garment.id,
      garmentCode: garment.garmentCode,
      orderNumber: garment.order.orderNumber,
      typeName: garment.garmentType.name,
      categoryLabel: categoryLabel(garment.trackingCategory),
      taskStatus: task.status,
      mismatchAlert,
    };
  });
}
