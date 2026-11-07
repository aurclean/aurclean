"use server";

import { revalidatePath } from "next/cache";

import { revalidateMoney, revalidateOperational } from "@/lib/revalidate";

import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { PERMISSIONS } from "@/lib/rbac";
import {
  assertBranchAccess,
  assertFirmAccess,
  authorize,
  hasPermission,
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
import { computeTotals, formatCurrency, num, round2 } from "@/lib/money";
import { nextRefundNumber } from "@/lib/sequence";
import {
  createOrder,
  recalcOrderPayments,
  recalcOrderTotals,
  setOrderStatus,
} from "@/lib/services/orders";
import { notify } from "@/lib/services/notifications";
import { canTransition } from "@/lib/workflow";
import {
  applyDiscountSchema,
  cancelOrderSchema,
  createOrderSchema,
  orderStatusSchema,
  updateOrderSchema,
} from "@/lib/validations/order";

export async function createOrderAction(
  payload: unknown,
): Promise<ActionResult<{ id: string; orderNumber: string; garmentCount: number }>> {
  return runAction(async () => {
    const user = await authorize(PERMISSIONS.ORDER_CREATE);

    const limit = rateLimit(
      `order:create:${user.id}`,
      RATE_LIMITS.MUTATION.limit,
      RATE_LIMITS.MUTATION.windowMs,
    );
    if (!limit.success) {
      throw new BusinessRuleError("Too many orders created too quickly. Pause a moment.");
    }

    const input = createOrderSchema.parse(payload);
    const branchId = await requireWriteBranch(user, input.branchId);

    if (input.discountAmount > 0 && !hasPermission(user, PERMISSIONS.ORDER_APPLY_DISCOUNT)) {
      throw new BusinessRuleError("You are not allowed to apply discounts");
    }

    const result = await createOrder(
      { ...input, branchId },
      {
        userId: user.id,
        userName: user.name,
        branchId,
        firmId: requireFirmId(user),
        canOverridePrice: hasPermission(user, PERMISSIONS.ORDER_OVERRIDE_PRICE),
      },
    );

    await recordAudit({
      userId: user.id,
      branchId,
      action: "ORDER_CREATED",
      entity: "Order",
      entityId: result.id,
      summary: `Created ${result.orderNumber} for ${input.customerName} (${result.garmentCount} garments, ${formatCurrency(result.totalAmount)})`,
      after: { orderNumber: result.orderNumber, total: result.totalAmount },
    });

    revalidateOperational();

    return {
      id: result.id,
      orderNumber: result.orderNumber,
      garmentCount: result.garmentCount,
    };
  });
}

export async function updateOrderAction(payload: unknown): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize(PERMISSIONS.ORDER_UPDATE);
    const input = updateOrderSchema.parse(payload);

    const existing = await prisma.order.findUnique({
      where: { id: input.orderId },
      select: {
        id: true,
        branchId: true,
        firmId: true,
        status: true,
        orderNumber: true,
        customerName: true,
        customerPhone: true,
        expectedDeliveryAt: true,
      },
    });
    if (!existing) throw new NotFoundError("Order not found");
    assertBranchAccess(user, existing.branchId);
    assertFirmAccess(user, existing.firmId);

    if (["CANCELLED", "REFUNDED"].includes(existing.status)) {
      throw new BusinessRuleError("A cancelled order can no longer be edited");
    }

    await prisma.order.update({
      where: { id: input.orderId },
      data: {
        customerName: input.customerName,
        customerPhone: input.customerPhone,
        customerEmail: input.customerEmail ?? null,
        addressLine: input.addressLine ?? null,
        city: input.city ?? null,
        pincode: input.pincode ?? null,
        landmark: input.landmark ?? null,
        expectedDeliveryAt: input.expectedDeliveryAt,
        priority: input.priority,
        specialInstructions: input.specialInstructions ?? null,
        stainNotes: input.stainNotes ?? null,
        damageNotes: input.damageNotes ?? null,
      },
    });

    await recordAudit({
      userId: user.id,
      branchId: existing.branchId,
      action: "ORDER_UPDATED",
      entity: "Order",
      entityId: existing.id,
      summary: `Updated ${existing.orderNumber}`,
      before: existing,
      after: input,
    });

    revalidateOperational([`/orders/${input.orderId}`]);
    return null;
  });
}

export async function setOrderStatusAction(payload: unknown): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize(PERMISSIONS.ORDER_UPDATE);
    const input = orderStatusSchema.parse(payload);

    const order = await prisma.order.findUnique({
      where: { id: input.orderId },
      select: {
        id: true,
        firmId: true,
        branchId: true,
        status: true,
        orderNumber: true,
        customerName: true,
        customerPhone: true,
        customerEmail: true,
        outstandingAmount: true,
      },
    });
    if (!order) throw new NotFoundError("Order not found");
    assertFirmAccess(user, order.firmId);
    assertBranchAccess(user, order.branchId);

    if (!canTransition(order.status, input.status)) {
      throw new BusinessRuleError(
        `An order cannot move from ${order.status.replace(/_/g, " ").toLowerCase()} to ${input.status.replace(/_/g, " ").toLowerCase()}`,
      );
    }

    if (input.status === "DELIVERED" && num(order.outstandingAmount) > 0) {
      const policy = await prisma.setting.findUnique({
        where: { firmId_key: { firmId: order.firmId, key: "require_full_payment_before_delivery" } },
      });
      if (policy?.value === "true") {
        throw new BusinessRuleError(
          `${order.orderNumber} has a balance of ${formatCurrency(order.outstandingAmount)}. Collect full payment before marking it delivered.`,
        );
      }
    }

    await prisma.$transaction((tx) =>
      setOrderStatus(tx, {
        orderId: order.id,
        status: input.status,
        actor: { userId: user.id, userName: user.name, branchId: order.branchId, firmId: order.firmId },
        note: input.note ?? "Status changed manually",
      }),
    );

    await recordAudit({
      userId: user.id,
      branchId: order.branchId,
      action: "ORDER_STATUS_CHANGED",
      entity: "Order",
      entityId: order.id,
      summary: `${order.orderNumber}: ${order.status} → ${input.status}`,
    });

    if (input.status === "READY") {
      await notify({
        event: "ORDER_READY",
        orderId: order.id,
        branchId: order.branchId,
        recipientName: order.customerName,
        recipientPhone: order.customerPhone,
        recipientEmail: order.customerEmail,
        variables: {
          customerName: order.customerName,
          orderNumber: order.orderNumber,
          outstanding: formatCurrency(order.outstandingAmount),
        },
      });
    }

    revalidateOperational([`/orders/${order.id}`]);
    return null;
  });
}

export async function cancelOrderAction(payload: unknown): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize(PERMISSIONS.ORDER_CANCEL);
    const input = cancelOrderSchema.parse(payload);

    const order = await prisma.order.findUnique({
      where: { id: input.orderId },
      select: {
        id: true,
        branchId: true,
        firmId: true,
        status: true,
        orderNumber: true,
        paidAmount: true,
        b2bAccountId: true,
        outstandingAmount: true,
      },
    });
    if (!order) throw new NotFoundError("Order not found");
    assertBranchAccess(user, order.branchId);
    assertFirmAccess(user, order.firmId);

    if (["DELIVERED", "CANCELLED", "REFUNDED"].includes(order.status)) {
      throw new BusinessRuleError(
        `${order.orderNumber} is already ${order.status.toLowerCase()} and cannot be cancelled`,
      );
    }

    const paid = num(order.paidAmount);
    if (input.refundAmount > paid) {
      throw new BusinessRuleError("The refund cannot exceed the amount collected");
    }
    if (input.refundAmount > 0 && !hasPermission(user, PERMISSIONS.BILLING_REFUND)) {
      throw new BusinessRuleError("You are not allowed to issue refunds");
    }

    await prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: order.id },
        data: {
          status: input.refundAmount > 0 ? "REFUNDED" : "CANCELLED",
          cancelledAt: new Date(),
          cancellationReason: input.reason,
        },
      });

      await tx.orderStatusHistory.create({
        data: {
          orderId: order.id,
          fromStatus: order.status,
          toStatus: input.refundAmount > 0 ? "REFUNDED" : "CANCELLED",
          userId: user.id,
          userName: user.name,
          note: input.reason,
        },
      });

      // Open processing work is abandoned, not silently completed.
      await tx.processingTask.updateMany({
        where: { garment: { orderId: order.id }, status: { in: ["PENDING", "IN_PROGRESS"] } },
        data: { status: "SKIPPED" },
      });

      if (input.refundAmount > 0) {
        await tx.refund.create({
          data: {
            refundNumber: await nextRefundNumber(tx),
            orderId: order.id,
            amount: input.refundAmount,
            reason: input.reason,
            status: "PROCESSED",
            processedById: user.id,
            processedAt: new Date(),
          },
        });
      }

      await tx.invoice.updateMany({
        where: { orderId: order.id, status: { not: "PAID" } },
        data: { status: "CANCELLED" },
      });

      if (order.b2bAccountId) {
        await tx.b2BAccount.update({
          where: { id: order.b2bAccountId },
          data: { outstandingBalance: { decrement: num(order.outstandingAmount) } },
        });
      }

      await recalcOrderPayments(tx, order.id);
    });

    await recordAudit({
      userId: user.id,
      branchId: order.branchId,
      action: "ORDER_CANCELLED",
      entity: "Order",
      entityId: order.id,
      summary: `Cancelled ${order.orderNumber}: ${input.reason}${input.refundAmount > 0 ? ` (refund ${formatCurrency(input.refundAmount)})` : ""}`,
    });

    revalidateOperational([`/orders/${order.id}`]);
    return null;
  });
}

export async function applyDiscountAction(payload: unknown): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize(PERMISSIONS.ORDER_APPLY_DISCOUNT);
    const input = applyDiscountSchema.parse(payload);

    const order = await prisma.order.findUnique({
      where: { id: input.orderId },
      select: {
        id: true,
        branchId: true,
        firmId: true,
        orderNumber: true,
        subtotal: true,
        gstRate: true,
        discountAmount: true,
        status: true,
      },
    });
    if (!order) throw new NotFoundError("Order not found");
    assertBranchAccess(user, order.branchId);
    assertFirmAccess(user, order.firmId);
    if (["CANCELLED", "REFUNDED", "DELIVERED"].includes(order.status)) {
      throw new BusinessRuleError("This order is closed and its pricing cannot change");
    }

    if (input.discountAmount > num(order.subtotal)) {
      throw new BusinessRuleError("The discount cannot exceed the order subtotal");
    }

    const totals = computeTotals({
      subtotal: num(order.subtotal),
      discountAmount: input.discountAmount,
      gstRate: num(order.gstRate),
    });

    await prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: order.id },
        data: {
          discountAmount: totals.discountAmount,
          discountReason: input.discountReason ?? null,
        },
      });
      await recalcOrderTotals(tx, order.id);
    });

    await recordAudit({
      userId: user.id,
      branchId: order.branchId,
      action: "ORDER_DISCOUNT_APPLIED",
      entity: "Order",
      entityId: order.id,
      summary: `Discount on ${order.orderNumber}: ${formatCurrency(num(order.discountAmount))} → ${formatCurrency(totals.discountAmount)}`,
      before: { discountAmount: num(order.discountAmount) },
      after: { discountAmount: totals.discountAmount, reason: input.discountReason },
    });

    revalidatePath(`/orders/${order.id}`);
    return null;
  });
}

/** Sends every garment on an order back through washing. */
export async function rewashOrderAction(
  orderId: string,
  reason: string,
): Promise<ActionResult<{ count: number }>> {
  return runAction(async () => {
    const user = await authorize(PERMISSIONS.ORDER_UPDATE);

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, branchId: true, firmId: true, orderNumber: true, status: true },
    });
    if (!order) throw new NotFoundError("Order not found");
    assertBranchAccess(user, order.branchId);
    assertFirmAccess(user, order.firmId);
    if (["CANCELLED", "REFUNDED"].includes(order.status)) {
      throw new BusinessRuleError("This order is closed");
    }
    if (reason.trim().length < 3) {
      throw new BusinessRuleError("Give a reason for the rewash");
    }

    const count = await prisma.$transaction(async (tx) => {
      const garments = await tx.garment.findMany({
        where: { orderId, status: { notIn: ["LOST", "DELIVERED"] } },
        include: { tasks: { orderBy: { sequence: "asc" } } },
      });

      for (const garment of garments) {
        const washTask =
          garment.tasks.find((t) => t.stage === "WASHING") ?? garment.tasks[0];
        if (!washTask) continue;

        await tx.processingTask.updateMany({
          where: { garmentId: garment.id, sequence: { gte: washTask.sequence } },
          data: {
            status: "PENDING",
            startedAt: null,
            completedAt: null,
            durationSeconds: null,
          },
        });

        await tx.garment.update({
          where: { id: garment.id },
          data: {
            status: "REWASH",
            currentStage: washTask.stage,
            rewashCount: { increment: 1 },
          },
        });

        await tx.garmentStatusHistory.create({
          data: {
            garmentId: garment.id,
            fromStatus: garment.status,
            toStatus: "REWASH",
            stage: washTask.stage,
            branchId: order.branchId,
            userId: user.id,
            userName: user.name,
            note: `Order-wide rewash: ${reason}`,
          },
        });
      }

      await setOrderStatus(tx, {
        orderId: order.id,
        status: "WASHING",
        actor: { userId: user.id, userName: user.name, branchId: order.branchId, firmId: order.firmId },
        note: `Rewash requested: ${reason}`,
      });

      return garments.length;
    });

    await recordAudit({
      userId: user.id,
      branchId: order.branchId,
      action: "ORDER_REWASH",
      entity: "Order",
      entityId: order.id,
      summary: `Rewash of ${order.orderNumber} (${count} garments): ${reason}`,
    });

    revalidateOperational([`/orders/${orderId}`]);
    return { count };
  });
}

/** Quote endpoint used by the order form to price lines as they are typed. */
export async function quoteOrderAction(payload: {
  items: { serviceId: string; garmentTypeId: string; quantity: number; weightKg: number }[];
  b2bAccountId?: string | null;
  discountAmount: number;
  gstRate: number;
}): Promise<ActionResult<{
  lines: { unitPrice: number; lineTotal: number; pricingMode: string }[];
  subtotal: number;
  discountAmount: number;
  taxableAmount: number;
  gstAmount: number;
  totalAmount: number;
}>> {
  return runAction(async () => {
    await authorize([PERMISSIONS.ORDER_CREATE, PERMISSIONS.ORDER_UPDATE]);
    const { resolvePrice } = await import("@/lib/services/pricing");

    const lines = await Promise.all(
      payload.items.map(async (item) => {
        const resolved = await resolvePrice({
          serviceId: item.serviceId,
          garmentTypeId: item.garmentTypeId,
          quantity: item.quantity,
          weightKg: item.weightKg,
          b2bAccountId: payload.b2bAccountId ?? null,
        });
        return {
          unitPrice: resolved.unitPrice,
          lineTotal: resolved.lineTotal,
          pricingMode: resolved.pricingMode as string,
        };
      }),
    );

    const subtotal = round2(lines.reduce((sum, line) => sum + line.lineTotal, 0));
    const totals = computeTotals({
      subtotal,
      discountAmount: payload.discountAmount,
      gstRate: payload.gstRate,
    });

    return { lines, ...totals };
  });
}
