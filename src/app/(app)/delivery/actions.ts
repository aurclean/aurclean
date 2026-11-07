"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { revalidateMoney, revalidateOperational } from "@/lib/revalidate";

import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { PERMISSIONS } from "@/lib/rbac";
import { cuidSchema } from "@/lib/validations/common";
import {
  assertBranchAccess,
  assertFirmAccess,
  authorize,
  hasPermission,
} from "@/lib/session";
import {
  BusinessRuleError,
  NotFoundError,
  runAction,
  type ActionResult,
} from "@/lib/action-result";
import { formatCurrency, num, round2 } from "@/lib/money";
import { formatDateTime } from "@/lib/dates";
import { nextDeliveryNumber, nextPaymentNumber } from "@/lib/sequence";
import {
  recomputeOrderStatus,
  recordGarmentStatus,
} from "@/lib/services/garments";
import { recalcOrderPayments, setOrderStatus } from "@/lib/services/orders";
import { notify } from "@/lib/services/notifications";
import {
  advancePickupSchema,
  assignDriverSchema,
  completeDeliverySchema,
  createDeliverySchema,
  dispatchSchema,
} from "@/lib/validations/delivery";

export async function createDeliveryAction(
  payload: unknown,
): Promise<ActionResult<{ deliveryNumber: string }>> {
  return runAction(async () => {
    const user = await authorize(PERMISSIONS.DELIVERY_MANAGE);
    const input = createDeliverySchema.parse(payload);

    const order = await prisma.order.findUnique({
      where: { id: input.orderId },
      select: {
        id: true,
        firmId: true,
        branchId: true,
        orderNumber: true,
        status: true,
        outstandingAmount: true,
        garments: { select: { id: true }, where: { status: { notIn: ["DELIVERED", "LOST"] } } },
      },
    });
    if (!order) throw new NotFoundError("Order not found");
    assertFirmAccess(user, order.firmId);
    assertBranchAccess(user, order.branchId);

    if (["CANCELLED", "REFUNDED", "DELIVERED"].includes(order.status)) {
      throw new BusinessRuleError("This order is closed");
    }

    const delivery = await prisma.delivery.create({
      data: {
        deliveryNumber: await nextDeliveryNumber(),
        orderId: order.id,
        branchId: order.branchId,
        firmId: order.firmId,
        status: input.driverId ? "DRIVER_ASSIGNED" : "PENDING",
        driverId: input.driverId ?? null,
        assignedAt: input.driverId ? new Date() : null,
        scheduledAt: input.scheduledAt,
        contactName: input.contactName,
        contactPhone: input.contactPhone,
        addressLine: input.addressLine,
        landmark: input.landmark ?? null,
        amountToCollect: num(order.outstandingAmount),
        isPartial: input.isPartial,
        garmentCount: order.garments.length,
        notes: input.notes ?? null,
      },
    });

    await recordAudit({
      userId: user.id,
      branchId: order.branchId,
      action: "DELIVERY_SCHEDULED",
      entity: "Delivery",
      entityId: delivery.id,
      summary: `${delivery.deliveryNumber} for ${order.orderNumber} on ${formatDateTime(input.scheduledAt)}`,
    });

    revalidatePath("/delivery");
    revalidatePath(`/orders/${order.id}`);
    return { deliveryNumber: delivery.deliveryNumber };
  });
}

export async function assignDriverAction(payload: unknown): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize(PERMISSIONS.DELIVERY_ASSIGN_DRIVER);
    const input = assignDriverSchema.parse(payload);

    const driver = await prisma.driver.findUnique({
      where: { id: input.driverId },
      include: { user: { select: { name: true, branchId: true, status: true } } },
    });
    if (!driver) throw new NotFoundError("Driver not found");
    if (driver.user.status !== "ACTIVE") {
      throw new BusinessRuleError("That driver account is not active");
    }

    if (input.jobType === "PICKUP") {
      const pickup = await prisma.pickup.findUnique({
        where: { id: input.jobId },
        select: { id: true, branchId: true, pickupNumber: true, status: true },
      });
      if (!pickup) throw new NotFoundError("Pickup not found");
      assertBranchAccess(user, pickup.branchId);
      if (["PICKED_UP", "RECEIVED_AT_LAUNDRY", "CANCELLED"].includes(pickup.status)) {
        throw new BusinessRuleError("This pickup can no longer be reassigned");
      }

      await prisma.pickup.update({
        where: { id: pickup.id },
        data: {
          driverId: driver.id,
          status: "DRIVER_ASSIGNED",
          assignedAt: new Date(),
        },
      });

      await recordAudit({
        userId: user.id,
        branchId: pickup.branchId,
        action: "PICKUP_DRIVER_ASSIGNED",
        entity: "Pickup",
        entityId: pickup.id,
        summary: `${pickup.pickupNumber} assigned to ${driver.user.name}`,
      });
    } else {
      const delivery = await prisma.delivery.findUnique({
        where: { id: input.jobId },
        select: { id: true, branchId: true, firmId: true, deliveryNumber: true, status: true },
      });
      if (!delivery) throw new NotFoundError("Delivery not found");
      assertBranchAccess(user, delivery.branchId);
      assertFirmAccess(user, delivery.firmId);
      if (["DELIVERED", "CANCELLED"].includes(delivery.status)) {
        throw new BusinessRuleError("This delivery can no longer be reassigned");
      }

      await prisma.delivery.update({
        where: { id: delivery.id },
        data: {
          driverId: driver.id,
          status: "DRIVER_ASSIGNED",
          assignedAt: new Date(),
        },
      });

      await recordAudit({
        userId: user.id,
        branchId: delivery.branchId,
        action: "DELIVERY_DRIVER_ASSIGNED",
        entity: "Delivery",
        entityId: delivery.id,
        summary: `${delivery.deliveryNumber} assigned to ${driver.user.name}`,
      });
    }

    revalidatePath("/delivery");
    revalidatePath("/driver");
    return null;
  });
}

export async function advancePickupAction(payload: unknown): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize(PERMISSIONS.DELIVERY_MANAGE);
    const input = advancePickupSchema.parse(payload);

    const pickup = await prisma.pickup.findUnique({
      where: { id: input.pickupId },
      include: {
        driver: { select: { userId: true } },
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
    if (!pickup) throw new NotFoundError("Pickup not found");
    assertBranchAccess(user, pickup.branchId);

    // A driver may only act on their own jobs.
    const isDispatcher = hasPermission(user, PERMISSIONS.DELIVERY_MANAGE);
    if (!isDispatcher && pickup.driver?.userId !== user.id) {
      throw new BusinessRuleError("This pickup is assigned to another driver");
    }

    const now = new Date();
    await prisma.pickup.update({
      where: { id: pickup.id },
      data: {
        status: input.status,
        acceptedAt: input.status === "DRIVER_ACCEPTED" ? now : pickup.acceptedAt,
        pickedUpAt: input.status === "PICKED_UP" ? now : pickup.pickedUpAt,
        receivedAt: input.status === "RECEIVED_AT_LAUNDRY" ? now : pickup.receivedAt,
        failureReason: input.status === "FAILED" ? (input.note ?? "Pickup failed") : null,
        notes: input.note ?? pickup.notes,
      },
    });

    await recordAudit({
      userId: user.id,
      branchId: pickup.branchId,
      action: "PICKUP_STATUS_CHANGED",
      entity: "Pickup",
      entityId: pickup.id,
      summary: `${pickup.pickupNumber}: ${pickup.status} → ${input.status}`,
    });

    revalidatePath("/delivery");
    revalidatePath("/driver");
    return null;
  });
}

export async function dispatchDeliveryAction(payload: unknown): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize(PERMISSIONS.DELIVERY_MANAGE);
    const input = dispatchSchema.parse(payload);

    const delivery = await prisma.delivery.findUnique({
      where: { id: input.deliveryId },
      include: {
        driver: { select: { userId: true } },
        order: {
          select: {
            id: true,
            orderNumber: true,
            customerName: true,
            customerPhone: true,
            customerEmail: true,
            outstandingAmount: true,
          },
        },
      },
    });
    if (!delivery) throw new NotFoundError("Delivery not found");
    assertBranchAccess(user, delivery.branchId);
    assertFirmAccess(user, delivery.firmId);

    const isDispatcher = hasPermission(user, PERMISSIONS.DELIVERY_MANAGE);
    if (!isDispatcher && delivery.driver?.userId !== user.id) {
      throw new BusinessRuleError("This delivery is assigned to another driver");
    }
    if (!delivery.driverId) {
      throw new BusinessRuleError("Assign a driver before dispatching");
    }
    if (delivery.status === "DELIVERED") {
      throw new BusinessRuleError("This delivery is already complete");
    }

    await prisma.$transaction(async (tx) => {
      await tx.delivery.update({
        where: { id: delivery.id },
        data: { status: "OUT_FOR_DELIVERY", dispatchedAt: new Date() },
      });

      const garments = await tx.garment.findMany({
        where: {
          orderId: delivery.orderId,
          status: { in: ["READY", "PACKED"] },
        },
        select: { id: true, status: true },
      });

      for (const garment of garments) {
        await recordGarmentStatus(tx, {
          garmentId: garment.id,
          fromStatus: garment.status,
          toStatus: "OUT_FOR_DELIVERY",
          stage: "DISPATCH",
          actor: { userId: user.id, userName: user.name, branchId: delivery.branchId, firmId: delivery.firmId },
          note: `Loaded onto ${delivery.deliveryNumber}`,
        });
      }

      await setOrderStatus(tx, {
        orderId: delivery.orderId,
        status: "OUT_FOR_DELIVERY",
        actor: { userId: user.id, userName: user.name, branchId: delivery.branchId, firmId: delivery.firmId },
        note: `Dispatched on ${delivery.deliveryNumber}`,
      });
    });

    await notify({
      event: "OUT_FOR_DELIVERY",
      orderId: delivery.orderId,
      branchId: delivery.branchId,
      recipientName: delivery.order.customerName,
      recipientPhone: delivery.order.customerPhone,
      recipientEmail: delivery.order.customerEmail,
      variables: {
        customerName: delivery.order.customerName,
        orderNumber: delivery.order.orderNumber,
        outstanding: formatCurrency(delivery.order.outstandingAmount),
      },
    });

    await recordAudit({
      userId: user.id,
      branchId: delivery.branchId,
      action: "DELIVERY_DISPATCHED",
      entity: "Delivery",
      entityId: delivery.id,
      summary: `${delivery.deliveryNumber} is out for delivery`,
    });

    revalidatePath("/delivery");
    revalidatePath("/driver");
    revalidatePath(`/orders/${delivery.orderId}`);
    return null;
  });
}

/**
 * Closes out a delivery attempt: hands garments over, takes payment at the
 * door, or records a failure and a new date.
 */
export async function completeDeliveryAction(payload: unknown): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize(PERMISSIONS.DELIVERY_MANAGE);
    const input = completeDeliverySchema.parse(payload);

    const delivery = await prisma.delivery.findUnique({
      where: { id: input.deliveryId },
      include: {
        driver: { select: { userId: true } },
        order: {
          select: {
            id: true,
            orderNumber: true,
            customerName: true,
            customerPhone: true,
            customerEmail: true,
            outstandingAmount: true,
          },
        },
      },
    });
    if (!delivery) throw new NotFoundError("Delivery not found");
    assertBranchAccess(user, delivery.branchId);
    assertFirmAccess(user, delivery.firmId);

    const isDispatcher = hasPermission(user, PERMISSIONS.DELIVERY_MANAGE);
    if (!isDispatcher && delivery.driver?.userId !== user.id) {
      throw new BusinessRuleError("This delivery is assigned to another driver");
    }
    if (delivery.status === "DELIVERED") {
      throw new BusinessRuleError("This delivery is already complete");
    }

    if (input.amountCollected > 0) {
      if (!hasPermission(user, PERMISSIONS.DELIVERY_COLLECT_PAYMENT)) {
        throw new BusinessRuleError("You are not allowed to collect payment");
      }
      if (input.amountCollected > num(delivery.order.outstandingAmount)) {
        throw new BusinessRuleError(
          `Only ${formatCurrency(delivery.order.outstandingAmount)} is outstanding on this order`,
        );
      }
    }

    const now = new Date();

    await prisma.$transaction(async (tx) => {
      await tx.delivery.update({
        where: { id: delivery.id },
        data: {
          status:
            input.outcome === "DELIVERED"
              ? "DELIVERED"
              : input.outcome === "RESCHEDULED"
                ? "RESCHEDULED"
                : "FAILED",
          deliveredAt: input.outcome === "DELIVERED" ? now : null,
          receivedByName: input.receivedByName ?? null,
          amountCollected: round2(
            num(delivery.amountCollected) + input.amountCollected,
          ),
          collectionMethod:
            input.amountCollected > 0 ? input.collectionMethod : delivery.collectionMethod,
          failureReason:
            input.outcome === "DELIVERED" ? null : (input.failureReason ?? "Not delivered"),
          rescheduledFor: input.rescheduledFor,
          attemptCount: { increment: 1 },
          notes: input.notes ?? delivery.notes,
        },
      });

      if (input.amountCollected > 0) {
        const invoice = await tx.invoice.findFirst({
          where: { orderId: delivery.orderId },
          select: { id: true },
        });

        await tx.payment.create({
          data: {
            paymentNumber: await nextPaymentNumber(tx),
            branchId: delivery.branchId,
            firmId: delivery.firmId,
            orderId: delivery.orderId,
            invoiceId: invoice?.id ?? null,
            amount: input.amountCollected,
            method: input.collectionMethod,
            provider: "MANUAL",
            state: "CAPTURED",
            receivedById: user.id,
            notes: `Collected on delivery ${delivery.deliveryNumber}`,
          },
        });

        await recalcOrderPayments(tx, delivery.orderId);
      }

      if (input.outcome === "DELIVERED") {
        const garments = await tx.garment.findMany({
          where: {
            orderId: delivery.orderId,
            status: { notIn: ["DELIVERED", "LOST"] },
          },
          select: { id: true, status: true },
        });

        for (const garment of garments) {
          await recordGarmentStatus(tx, {
            garmentId: garment.id,
            fromStatus: garment.status,
            toStatus: "DELIVERED",
            stage: "DISPATCH",
            actor: { userId: user.id, userName: user.name, branchId: delivery.branchId, firmId: delivery.firmId },
            note: `Delivered on ${delivery.deliveryNumber}`,
            extraData: { deliveredAt: now },
          });
        }

        await tx.processingTask.updateMany({
          where: {
            garment: { orderId: delivery.orderId },
            stage: "DISPATCH",
            status: { in: ["PENDING", "IN_PROGRESS"] },
          },
          data: { status: "COMPLETED", completedAt: now },
        });

        await recomputeOrderStatus(tx, delivery.orderId, {
          userId: user.id,
          userName: user.name,
          branchId: delivery.branchId,
          firmId: delivery.firmId,
        });
      } else {
        await setOrderStatus(tx, {
          orderId: delivery.orderId,
          status: "READY",
          actor: { userId: user.id, userName: user.name, branchId: delivery.branchId, firmId: delivery.firmId },
          note: `Delivery attempt failed: ${input.failureReason ?? "no reason given"}`,
        });
      }
    });

    if (input.outcome === "DELIVERED") {
      await notify({
        event: "DELIVERED",
        orderId: delivery.orderId,
        branchId: delivery.branchId,
        recipientName: delivery.order.customerName,
        recipientPhone: delivery.order.customerPhone,
        recipientEmail: delivery.order.customerEmail,
        variables: {
          customerName: delivery.order.customerName,
          orderNumber: delivery.order.orderNumber,
        },
      });
    }

    await recordAudit({
      userId: user.id,
      branchId: delivery.branchId,
      action: `DELIVERY_${input.outcome}`,
      entity: "Delivery",
      entityId: delivery.id,
      summary: `${delivery.deliveryNumber} → ${input.outcome}${input.amountCollected > 0 ? ` · collected ${formatCurrency(input.amountCollected)}` : ""}`,
    });

    revalidateOperational([`/orders/${delivery.orderId}`, "/delivery", "/driver"]);
    return null;
  });
}


/**
 * Calling off a run that is not going to happen.
 *
 * Deliveries and pickups are jobs, not documents: they are cancelled rather
 * than deleted so the attempt stays visible on the order, and one that has
 * already been completed cannot be undone this way.
 */
export async function cancelDeliveryAction(payload: unknown): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize(PERMISSIONS.DELIVERY_MANAGE);
    const { deliveryId, reason } = z
      .object({ deliveryId: cuidSchema, reason: z.string().trim().max(300).optional() })
      .parse(payload);

    const delivery = await prisma.delivery.findUnique({
      where: { id: deliveryId },
      select: {
        id: true,
        deliveryNumber: true,
        branchId: true,
        firmId: true,
        orderId: true,
        status: true,
      },
    });
    if (!delivery) throw new NotFoundError("Delivery not found");
    assertBranchAccess(user, delivery.branchId);
    assertFirmAccess(user, delivery.firmId);

    if (delivery.status === "DELIVERED") {
      throw new BusinessRuleError(
        `${delivery.deliveryNumber} was completed — raise a return instead`,
      );
    }
    if (delivery.status === "CANCELLED") {
      throw new BusinessRuleError(`${delivery.deliveryNumber} is already cancelled`);
    }

    await prisma.delivery.update({
      where: { id: deliveryId },
      data: {
        status: "CANCELLED",
        failureReason: reason ?? "Cancelled at the branch",
      },
    });

    await recordAudit({
      userId: user.id,
      branchId: delivery.branchId,
      action: "DELIVERY_CANCELLED",
      entity: "Delivery",
      entityId: deliveryId,
      summary: `${delivery.deliveryNumber} cancelled`,
    });

    revalidateOperational([`/orders/${delivery.orderId}`]);
    return null;
  });
}

export async function cancelPickupAction(payload: unknown): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize(PERMISSIONS.DELIVERY_MANAGE);
    const { pickupId, reason } = z
      .object({ pickupId: cuidSchema, reason: z.string().trim().max(300).optional() })
      .parse(payload);

    const pickup = await prisma.pickup.findUnique({
      where: { id: pickupId },
      select: {
        id: true,
        pickupNumber: true,
        branchId: true,
        orderId: true,
        status: true,
      },
    });
    if (!pickup) throw new NotFoundError("Pickup not found");
    assertBranchAccess(user, pickup.branchId);

    if (pickup.status === "RECEIVED_AT_LAUNDRY") {
      throw new BusinessRuleError(
        `${pickup.pickupNumber} has already been collected`,
      );
    }
    if (pickup.status === "CANCELLED") {
      throw new BusinessRuleError(`${pickup.pickupNumber} is already cancelled`);
    }

    await prisma.pickup.update({
      where: { id: pickupId },
      data: { status: "CANCELLED", notes: reason ?? "Cancelled at the branch" },
    });

    await recordAudit({
      userId: user.id,
      branchId: pickup.branchId,
      action: "PICKUP_CANCELLED",
      entity: "Pickup",
      entityId: pickupId,
      summary: `${pickup.pickupNumber} cancelled`,
    });

    revalidateOperational([`/orders/${pickup.orderId}`]);
    return null;
  });
}
