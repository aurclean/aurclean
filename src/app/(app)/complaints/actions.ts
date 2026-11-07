"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { PERMISSIONS } from "@/lib/rbac";
import {
  assertBranchAccess,
  assertFirmAccess,
  authorize,
  requireFirmId,
  requireWriteBranch,
} from "@/lib/session";
import {
  BusinessRuleError,
  NotFoundError,
  runAction,
  type ActionResult,
} from "@/lib/action-result";
import { RATE_LIMITS, rateLimit } from "@/lib/rate-limit";
import { formatCurrency, num } from "@/lib/money";
import { nextComplaintNumber, nextRefundNumber } from "@/lib/sequence";
import { notify } from "@/lib/services/notifications";
import {
  assertUploadAllowed,
  getStorageProvider,
} from "@/lib/providers/storage";
import {
  createComplaintSchema,
  resolveComplaintSchema,
  updateComplaintSchema,
} from "@/lib/validations/complaint";
import { recalcOrderPayments } from "@/lib/services/orders";

export async function createComplaintAction(
  payload: unknown,
): Promise<ActionResult<{ id: string; complaintNumber: string }>> {
  return runAction(async () => {
    const user = await authorize(PERMISSIONS.COMPLAINT_CREATE);
    const input = createComplaintSchema.parse(payload);
    const branchId = await requireWriteBranch(user, input.branchId);

    if (input.orderId) {
      const order = await prisma.order.findUnique({
        where: { id: input.orderId },
        select: { branchId: true, firmId: true },
      });
      if (!order) throw new NotFoundError("Order not found");
      assertFirmAccess(user, order.firmId);
      assertBranchAccess(user, order.branchId);
    }

    const complaint = await prisma.complaint.create({
      data: {
        complaintNumber: await nextComplaintNumber(),
        branchId,
        firmId: requireFirmId(user),
        type: input.type,
        priority: input.priority,
        status: "OPEN",
        orderId: input.orderId ?? null,
        garmentId: input.garmentId ?? null,
        raisedByName: input.raisedByName,
        raisedByPhone: input.raisedByPhone ?? null,
        description: input.description,
        assignedToId: input.assignedToId ?? null,
        createdById: user.id,
      },
      include: {
        order: {
          select: {
            id: true,
            orderNumber: true,
            customerName: true,
            customerPhone: true,
            customerEmail: true,
          },
        },
      },
    });

    await recordAudit({
      userId: user.id,
      branchId,
      action: "COMPLAINT_CREATED",
      entity: "Complaint",
      entityId: complaint.id,
      summary: `${complaint.complaintNumber} — ${input.type} raised by ${input.raisedByName}`,
    });

    if (complaint.order) {
      await notify({
        event: "COMPLAINT_REGISTERED",
        orderId: complaint.order.id,
        branchId,
        recipientName: complaint.order.customerName,
        recipientPhone: input.raisedByPhone ?? complaint.order.customerPhone,
        recipientEmail: complaint.order.customerEmail,
        variables: {
          customerName: complaint.order.customerName,
          orderNumber: complaint.order.orderNumber,
          complaintNumber: complaint.complaintNumber,
        },
      });
    }

    revalidatePath("/complaints");
    return { id: complaint.id, complaintNumber: complaint.complaintNumber };
  });
}

export async function updateComplaintAction(payload: unknown): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize(PERMISSIONS.COMPLAINT_MANAGE);
    const input = updateComplaintSchema.parse(payload);

    const complaint = await prisma.complaint.findUnique({
      where: { id: input.complaintId },
      select: { id: true, branchId: true, firmId: true, complaintNumber: true, status: true },
    });
    if (!complaint) throw new NotFoundError("Complaint not found");
    assertBranchAccess(user, complaint.branchId);
    assertFirmAccess(user, complaint.firmId);

    if (["RESOLVED", "CLOSED"].includes(complaint.status) && input.status) {
      throw new BusinessRuleError("This complaint is already closed");
    }

    await prisma.complaint.update({
      where: { id: complaint.id },
      data: {
        ...(input.status ? { status: input.status } : {}),
        ...(input.priority ? { priority: input.priority } : {}),
        assignedToId: input.assignedToId ?? undefined,
        investigationNotes: input.investigationNotes ?? undefined,
      },
    });

    await recordAudit({
      userId: user.id,
      branchId: complaint.branchId,
      action: "COMPLAINT_UPDATED",
      entity: "Complaint",
      entityId: complaint.id,
      summary: `${complaint.complaintNumber} updated${input.status ? ` → ${input.status}` : ""}`,
    });

    revalidatePath("/complaints");
    revalidatePath(`/complaints/${complaint.id}`);
    return null;
  });
}

/**
 * Closes a complaint and carries out the remedy — a refund is booked against
 * the order, a rewash puts the garments back in the queue.
 */
export async function resolveComplaintAction(payload: unknown): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize(PERMISSIONS.COMPLAINT_RESOLVE);
    const input = resolveComplaintSchema.parse(payload);

    const complaint = await prisma.complaint.findUnique({
      where: { id: input.complaintId },
      include: {
        order: {
          select: {
            id: true,
            orderNumber: true,
            customerName: true,
            customerPhone: true,
            customerEmail: true,
            paidAmount: true,
            refundedAmount: true,
          },
        },
        garment: { select: { id: true, garmentCode: true, status: true } },
      },
    });
    if (!complaint) throw new NotFoundError("Complaint not found");
    assertBranchAccess(user, complaint.branchId);
    assertFirmAccess(user, complaint.firmId);
    if (["RESOLVED", "CLOSED"].includes(complaint.status)) {
      throw new BusinessRuleError("This complaint is already resolved");
    }

    const needsMoney = ["REFUND", "COMPENSATION"].includes(input.resolution);
    if (needsMoney && input.compensationAmount <= 0) {
      throw new BusinessRuleError("Enter the amount to refund or compensate");
    }

    if (input.resolution === "REFUND") {
      if (!complaint.order) {
        throw new BusinessRuleError("A refund needs the complaint to reference an order");
      }
      const refundable =
        num(complaint.order.paidAmount) - num(complaint.order.refundedAmount);
      if (input.compensationAmount > refundable) {
        throw new BusinessRuleError(
          `At most ${formatCurrency(refundable)} can be refunded on ${complaint.order.orderNumber}`,
        );
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.complaint.update({
        where: { id: complaint.id },
        data: {
          status: "RESOLVED",
          resolution: input.resolution,
          resolutionNotes: input.resolutionNotes,
          compensationAmount: needsMoney ? input.compensationAmount : null,
          resolvedAt: new Date(),
          resolvedById: user.id,
        },
      });

      if (input.resolution === "REFUND" && complaint.order) {
        await tx.refund.create({
          data: {
            refundNumber: await nextRefundNumber(tx),
            orderId: complaint.order.id,
            amount: input.compensationAmount,
            method: "CASH",
            status: "PROCESSED",
            reason: `Complaint ${complaint.complaintNumber}: ${input.resolutionNotes}`,
            processedById: user.id,
            processedAt: new Date(),
          },
        });
        await recalcOrderPayments(tx, complaint.order.id);
      }

      if (
        ["REWASH", "REWORK"].includes(input.resolution) &&
        complaint.garment
      ) {
        const targetStage = input.resolution === "REWASH" ? "WASHING" : "IRONING";
        const task = await tx.processingTask.findFirst({
          where: { garmentId: complaint.garment.id, stage: targetStage },
        });

        if (task) {
          await tx.processingTask.updateMany({
            where: { garmentId: complaint.garment.id, sequence: { gte: task.sequence } },
            data: {
              status: "PENDING",
              startedAt: null,
              completedAt: null,
              durationSeconds: null,
            },
          });

          await tx.garment.update({
            where: { id: complaint.garment.id },
            data: {
              status: input.resolution === "REWASH" ? "REWASH" : "REWORK",
              currentStage: targetStage,
              ...(input.resolution === "REWASH"
                ? { rewashCount: { increment: 1 } }
                : { reworkCount: { increment: 1 } }),
            },
          });

          await tx.garmentStatusHistory.create({
            data: {
              garmentId: complaint.garment.id,
              fromStatus: complaint.garment.status,
              toStatus: input.resolution === "REWASH" ? "REWASH" : "REWORK",
              stage: targetStage,
              branchId: complaint.branchId,
              userId: user.id,
              userName: user.name,
              note: `Complaint ${complaint.complaintNumber}: ${input.resolutionNotes}`,
            },
          });
        }
      }
    });

    await recordAudit({
      userId: user.id,
      branchId: complaint.branchId,
      action: "COMPLAINT_RESOLVED",
      entity: "Complaint",
      entityId: complaint.id,
      summary: `${complaint.complaintNumber} resolved as ${input.resolution}${needsMoney ? ` (${formatCurrency(input.compensationAmount)})` : ""}`,
    });

    if (complaint.order) {
      await notify({
        event: "COMPLAINT_RESOLVED",
        orderId: complaint.order.id,
        branchId: complaint.branchId,
        recipientName: complaint.order.customerName,
        recipientPhone: complaint.raisedByPhone ?? complaint.order.customerPhone,
        recipientEmail: complaint.order.customerEmail,
        variables: {
          customerName: complaint.order.customerName,
          orderNumber: complaint.order.orderNumber,
          complaintNumber: complaint.complaintNumber,
        },
      });
    }

    revalidatePath("/complaints");
    revalidatePath(`/complaints/${complaint.id}`);
    return null;
  });
}

export async function uploadComplaintAttachmentAction(
  formData: FormData,
): Promise<ActionResult<{ url: string }>> {
  return runAction(async () => {
    const user = await authorize([PERMISSIONS.COMPLAINT_CREATE, PERMISSIONS.COMPLAINT_MANAGE]);

    const limit = rateLimit(
      `upload:${user.id}`,
      RATE_LIMITS.UPLOAD.limit,
      RATE_LIMITS.UPLOAD.windowMs,
    );
    if (!limit.success) throw new BusinessRuleError("Too many uploads — try again shortly");

    const complaintId = String(formData.get("complaintId") ?? "");
    const caption = String(formData.get("caption") ?? "").slice(0, 200);
    const file = formData.get("file");

    if (!(file instanceof File)) throw new BusinessRuleError("Choose an image to upload");
    assertUploadAllowed({ type: file.type, size: file.size });

    const complaint = await prisma.complaint.findUnique({
      where: { id: complaintId },
      select: { id: true, branchId: true, firmId: true, complaintNumber: true },
    });
    if (!complaint) throw new NotFoundError("Complaint not found");
    assertBranchAccess(user, complaint.branchId);
    assertFirmAccess(user, complaint.firmId);

    const stored = await getStorageProvider().upload({
      body: Buffer.from(await file.arrayBuffer()),
      mimeType: file.type,
      originalName: file.name,
      folder: `complaints/${complaint.complaintNumber}`,
    });

    await prisma.complaintAttachment.create({
      data: {
        complaintId: complaint.id,
        url: stored.url,
        storageKey: stored.key,
        mimeType: stored.mimeType,
        sizeBytes: stored.size,
        caption: caption || null,
        uploadedById: user.id,
      },
    });

    revalidatePath(`/complaints/${complaint.id}`);
    return { url: stored.url };
  });
}
