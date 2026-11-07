"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { revalidateMoney, revalidateOperational } from "@/lib/revalidate";

import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { PERMISSIONS } from "@/lib/rbac";
import { cuidSchema } from "@/lib/validations/common";
import { assertBranchAccess, assertFirmAccess, authorize, requireFirmId } from "@/lib/session";
import {
  BusinessRuleError,
  NotFoundError,
  runAction,
  type ActionResult,
} from "@/lib/action-result";
import { RATE_LIMITS, rateLimit } from "@/lib/rate-limit";
import { formatCurrency, num, round2 } from "@/lib/money";
import { nextPaymentNumber, nextRefundNumber } from "@/lib/sequence";
import { recalcOrderPayments } from "@/lib/services/orders";
import { notify } from "@/lib/services/notifications";
import {
  buildUpiIntentUri,
  getPaymentGateway,
} from "@/lib/providers/payments";
import {
  onlinePaymentIntentSchema,
  recordPaymentSchema,
  refundSchema,
  verifyOnlinePaymentSchema,
} from "@/lib/validations/billing";

export async function recordPaymentAction(
  payload: unknown,
): Promise<ActionResult<{ paymentNumber: string; outstanding: number }>> {
  return runAction(async () => {
    const user = await authorize(PERMISSIONS.BILLING_RECORD_PAYMENT);
    const input = recordPaymentSchema.parse(payload);

    const limit = rateLimit(
      `payment:${user.id}`,
      RATE_LIMITS.MUTATION.limit,
      RATE_LIMITS.MUTATION.windowMs,
    );
    if (!limit.success) throw new BusinessRuleError("Too many payments too quickly");

    const order = await prisma.order.findUnique({
      where: { id: input.orderId },
      select: {
        id: true,
        branchId: true,
        firmId: true,
        orderNumber: true,
        status: true,
        totalAmount: true,
        paidAmount: true,
        customerName: true,
        customerPhone: true,
        customerEmail: true,
      },
    });
    if (!order) throw new NotFoundError("Order not found");
    assertBranchAccess(user, order.branchId);
    assertFirmAccess(user, order.firmId);

    if (["CANCELLED", "REFUNDED"].includes(order.status)) {
      throw new BusinessRuleError("This order is closed — no further payments can be taken");
    }

    const outstanding = round2(num(order.totalAmount) - num(order.paidAmount));
    if (input.amount > outstanding) {
      throw new BusinessRuleError(
        `Only ${formatCurrency(outstanding)} is outstanding on ${order.orderNumber}`,
      );
    }

    const invoice = await prisma.invoice.findFirst({
      where: { orderId: order.id },
      select: { id: true },
    });

    const { payment, newOutstanding } = await prisma.$transaction(async (tx) => {
      const created = await tx.payment.create({
        data: {
          paymentNumber: await nextPaymentNumber(tx),
          branchId: order.branchId,
          firmId: order.firmId,
          orderId: order.id,
          invoiceId: invoice?.id ?? null,
          amount: input.amount,
          method: input.method,
          provider: "MANUAL",
          state: "CAPTURED",
          reference: input.reference ?? null,
          notes: input.notes ?? null,
          receivedById: user.id,
        },
      });

      await recalcOrderPayments(tx, order.id);

      const refreshed = await tx.order.findUnique({
        where: { id: order.id },
        select: { outstandingAmount: true },
      });

      return { payment: created, newOutstanding: num(refreshed?.outstandingAmount) };
    });

    await recordAudit({
      userId: user.id,
      branchId: order.branchId,
      action: "PAYMENT_RECORDED",
      entity: "Payment",
      entityId: payment.id,
      summary: `${formatCurrency(input.amount)} (${input.method}) against ${order.orderNumber}`,
    });

    await notify({
      event: "PAYMENT_RECEIVED",
      orderId: order.id,
      branchId: order.branchId,
      recipientName: order.customerName,
      recipientPhone: order.customerPhone,
      recipientEmail: order.customerEmail,
      variables: {
        customerName: order.customerName,
        orderNumber: order.orderNumber,
        amount: formatCurrency(input.amount),
        outstanding: formatCurrency(newOutstanding),
      },
    });

    revalidateOperational([`/orders/${order.id}`]);
    revalidateMoney();

    return { paymentNumber: payment.paymentNumber, outstanding: newOutstanding };
  });
}

export async function refundAction(
  payload: unknown,
): Promise<ActionResult<{ refundNumber: string }>> {
  return runAction(async () => {
    const user = await authorize(PERMISSIONS.BILLING_REFUND);
    const input = refundSchema.parse(payload);

    const order = await prisma.order.findUnique({
      where: { id: input.orderId },
      select: {
        id: true,
        branchId: true,
        firmId: true,
        orderNumber: true,
        paidAmount: true,
        refundedAmount: true,
      },
    });
    if (!order) throw new NotFoundError("Order not found");
    assertBranchAccess(user, order.branchId);
    assertFirmAccess(user, order.firmId);

    const refundable = round2(num(order.paidAmount) - num(order.refundedAmount));
    if (input.amount > refundable) {
      throw new BusinessRuleError(
        `At most ${formatCurrency(refundable)} can be refunded on ${order.orderNumber}`,
      );
    }

    // An online capture is reversed through the gateway; counter payments are
    // handed back in cash and only recorded here.
    const onlinePayment = await prisma.payment.findFirst({
      where: {
        orderId: order.id,
        state: "CAPTURED",
        provider: { not: "MANUAL" },
        providerPaymentId: { not: null },
      },
      orderBy: { paidAt: "desc" },
    });

    let providerRefundId: string | null = null;
    if (onlinePayment?.providerPaymentId) {
      const gateway = getPaymentGateway(onlinePayment.provider.toLowerCase());
      const outcome = await gateway.refund({
        providerPaymentId: onlinePayment.providerPaymentId,
        amount: input.amount,
        reason: input.reason,
      });
      providerRefundId = outcome.providerRefundId;
    }

    const refund = await prisma.$transaction(async (tx) => {
      const created = await tx.refund.create({
        data: {
          refundNumber: await nextRefundNumber(tx),
          orderId: order.id,
          paymentId: onlinePayment?.id ?? null,
          amount: input.amount,
          method: input.method,
          status: "PROCESSED",
          reason: input.reason,
          notes: [input.notes, providerRefundId ? `Gateway ref ${providerRefundId}` : null]
            .filter(Boolean)
            .join(" · ") || null,
          processedById: user.id,
          processedAt: new Date(),
        },
      });

      await recalcOrderPayments(tx, order.id);
      return created;
    });

    await recordAudit({
      userId: user.id,
      branchId: order.branchId,
      action: "REFUND_ISSUED",
      entity: "Refund",
      entityId: refund.id,
      summary: `${formatCurrency(input.amount)} refunded on ${order.orderNumber}: ${input.reason}`,
    });

    revalidateMoney([`/orders/${order.id}`]);
    return { refundNumber: refund.refundNumber };
  });
}

/**
 * Starts an online payment. Secrets stay on the server — only the gateway's
 * public key and the created order id are returned to the browser.
 */
export async function createPaymentIntentAction(
  payload: unknown,
): Promise<ActionResult<{
  provider: string;
  providerOrderId: string;
  clientPayload: Record<string, string | number>;
  upiUri: string | null;
}>> {
  return runAction(async () => {
    const user = await authorize(PERMISSIONS.BILLING_RECORD_PAYMENT);
    const input = onlinePaymentIntentSchema.parse(payload);

    const order = await prisma.order.findUnique({
      where: { id: input.orderId },
      select: {
        id: true,
        branchId: true,
        firmId: true,
        orderNumber: true,
        outstandingAmount: true,
        customerName: true,
        customerPhone: true,
        customerEmail: true,
      },
    });
    if (!order) throw new NotFoundError("Order not found");
    assertBranchAccess(user, order.branchId);
    assertFirmAccess(user, order.firmId);

    if (input.amount > num(order.outstandingAmount)) {
      throw new BusinessRuleError("That is more than the outstanding balance");
    }

    const gateway = getPaymentGateway();
    const intent = await gateway.createIntent({
      amount: input.amount,
      reference: order.orderNumber,
      customerName: order.customerName,
      customerPhone: order.customerPhone,
      customerEmail: order.customerEmail ?? undefined,
    });

    return {
      provider: gateway.id,
      providerOrderId: intent.providerOrderId,
      clientPayload: intent.clientPayload,
      upiUri: buildUpiIntentUri({
        amount: input.amount,
        reference: order.orderNumber,
        note: `Laundry order ${order.orderNumber}`,
      }),
    };
  });
}

/** Verifies a gateway callback signature and books the payment. */
export async function verifyOnlinePaymentAction(
  payload: unknown,
): Promise<ActionResult<{ paymentNumber: string }>> {
  return runAction(async () => {
    const user = await authorize(PERMISSIONS.BILLING_RECORD_PAYMENT);
    const input = verifyOnlinePaymentSchema.parse(payload);

    const order = await prisma.order.findUnique({
      where: { id: input.orderId },
      select: { id: true, branchId: true, firmId: true, orderNumber: true, outstandingAmount: true },
    });
    if (!order) throw new NotFoundError("Order not found");
    assertBranchAccess(user, order.branchId);
    assertFirmAccess(user, order.firmId);

    const gateway = getPaymentGateway();
    const verification = await gateway.verify({
      razorpay_order_id: input.razorpay_order_id,
      razorpay_payment_id: input.razorpay_payment_id,
      razorpay_signature: input.razorpay_signature,
    });

    if (!verification.verified) {
      await recordAudit({
        userId: user.id,
        branchId: order.branchId,
        action: "PAYMENT_VERIFICATION_FAILED",
        entity: "Order",
        entityId: order.id,
        summary: `Signature check failed for ${order.orderNumber}: ${verification.reason ?? "unknown"}`,
      });
      throw new BusinessRuleError("Payment could not be verified — nothing was recorded");
    }

    // The gateway may retry; a unique provider payment id keeps this idempotent.
    const existing = await prisma.payment.findFirst({
      where: { providerPaymentId: input.razorpay_payment_id },
      select: { paymentNumber: true },
    });
    if (existing) return { paymentNumber: existing.paymentNumber };

    const invoice = await prisma.invoice.findFirst({
      where: { orderId: order.id },
      select: { id: true },
    });

    const payment = await prisma.$transaction(async (tx) => {
      const created = await tx.payment.create({
        data: {
          paymentNumber: await nextPaymentNumber(tx),
          branchId: order.branchId,
          firmId: order.firmId,
          orderId: order.id,
          invoiceId: invoice?.id ?? null,
          amount: input.amount,
          method: "ONLINE",
          provider: "RAZORPAY",
          state: "CAPTURED",
          providerOrderId: input.razorpay_order_id,
          providerPaymentId: input.razorpay_payment_id,
          receivedById: user.id,
        },
      });
      await recalcOrderPayments(tx, order.id);
      return created;
    });

    await recordAudit({
      userId: user.id,
      branchId: order.branchId,
      action: "ONLINE_PAYMENT_CAPTURED",
      entity: "Payment",
      entityId: payment.id,
      summary: `${formatCurrency(input.amount)} captured online for ${order.orderNumber}`,
    });

    revalidateMoney([`/orders/${order.id}`]);
    return { paymentNumber: payment.paymentNumber };
  });
}

/** Sends a payment reminder for every order with a balance past its due date. */
export async function sendPaymentRemindersAction(): Promise<ActionResult<{ sent: number }>> {
  return runAction(async () => {
    const user = await authorize(PERMISSIONS.NOTIFICATION_MANAGE);
    const firmId = requireFirmId(user);

    const orders = await prisma.order.findMany({
      where: {
        firmId,
        outstandingAmount: { gt: 0 },
        status: { notIn: ["CANCELLED", "REFUNDED"] },
        expectedDeliveryAt: { lt: new Date() },
        ...(user.branchId && !user.permissions.includes(PERMISSIONS.DASHBOARD_VIEW_ALL_BRANCHES)
          ? { branchId: user.branchId }
          : {}),
      },
      take: 200,
      select: {
        id: true,
        branchId: true,
        orderNumber: true,
        customerName: true,
        customerPhone: true,
        customerEmail: true,
        outstandingAmount: true,
      },
    });

    for (const order of orders) {
      await notify({
        event: "PAYMENT_REMINDER",
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

    await recordAudit({
      userId: user.id,
      branchId: user.branchId,
      action: "PAYMENT_REMINDERS_SENT",
      entity: "Notification",
      summary: `${orders.length} payment reminders dispatched`,
    });

    revalidateMoney();
    return { sent: orders.length };
  });
}


/**
 * Voiding a payment that should never have been recorded — a mistyped amount,
 * a double entry at the counter.
 *
 * The row is not deleted: it is marked cancelled so the till still reconciles
 * and the correction is visible. A payment that has been refunded is left
 * alone, because the refund is already the record of what happened.
 */
export async function voidPaymentAction(
  payload: unknown,
): Promise<ActionResult<{ outstanding: number }>> {
  return runAction(async () => {
    const user = await authorize(PERMISSIONS.BILLING_REFUND);
    const { paymentId, reason } = z
      .object({ paymentId: cuidSchema, reason: z.string().trim().max(300).optional() })
      .parse(payload);

    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      select: {
        id: true,
        paymentNumber: true,
        branchId: true,
        firmId: true,
        orderId: true,
        amount: true,
        state: true,
        _count: { select: { refunds: true } },
      },
    });
    if (!payment) throw new NotFoundError("Payment not found");
    assertBranchAccess(user, payment.branchId);
    assertFirmAccess(user, payment.firmId);

    if (payment.state !== "CAPTURED") {
      throw new BusinessRuleError(
        `${payment.paymentNumber} is ${payment.state.toLowerCase()} and cannot be voided`,
      );
    }
    if (payment._count.refunds > 0) {
      throw new BusinessRuleError(
        `${payment.paymentNumber} has been refunded — the refund is the record`,
      );
    }

    const outstanding = await prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          state: "CANCELLED",
          notes: reason ?? "Voided at the counter",
        },
      });

      if (!payment.orderId) return 0;
      await recalcOrderPayments(tx, payment.orderId);
      const order = await tx.order.findUnique({
        where: { id: payment.orderId },
        select: { outstandingAmount: true },
      });
      return num(order?.outstandingAmount);
    });

    await recordAudit({
      userId: user.id,
      branchId: payment.branchId,
      action: "PAYMENT_VOIDED",
      entity: "Payment",
      entityId: payment.id,
      summary: `${payment.paymentNumber} voided (${formatCurrency(payment.amount)})`,
    });

    revalidateMoney(payment.orderId ? [`/orders/${payment.orderId}`] : []);
    revalidateOperational();
    return { outstanding };
  });
}
