import "server-only";
import { prisma } from "@/lib/prisma";
import { BusinessRuleError, NotFoundError } from "@/lib/action-result";
import { computeTotals, derivePaymentStatus, num, round2, round3, splitGst } from "@/lib/money";
import { nextInvoiceNumber, nextOrderNumber, nextPaymentNumber, nextPickupNumber } from "@/lib/sequence";
import { resolvePrice } from "@/lib/services/pricing";
import { createGarments, type ActorContext, type GarmentSeed } from "@/lib/services/garments";
import { recalcCustomerRollup, upsertCustomer } from "@/lib/services/customers";
import { notify } from "@/lib/services/notifications";
import { formatCurrency } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import type { CreateOrderInput } from "@/lib/validations/order";
import type { Prisma } from "@/generated/prisma/client";
import type { OrderStatus } from "@/generated/prisma/enums";

type Tx = Prisma.TransactionClient;

export interface CreatedOrder {
  id: string;
  orderNumber: string;
  totalAmount: number;
  garmentCount: number;
  customerId: string;
}

/**
 * Creates an order end to end: priced line items, one tracked garment per
 * piece with its processing pipeline, an invoice, any advance payment, and a
 * pickup job when the order was booked for collection. All in one transaction,
 * so a half-created order can never reach the shop floor.
 */
export async function createOrder(
  input: CreateOrderInput,
  actor: ActorContext & { canOverridePrice: boolean },
): Promise<CreatedOrder> {
  const [services, garmentTypes] = await Promise.all([
    prisma.service.findMany({
      where: { firmId: actor.firmId, id: { in: [...new Set(input.items.map((i) => i.serviceId))] } },
      select: { id: true, name: true, stages: true, isActive: true, turnaroundHours: true },
    }),
    prisma.garmentType.findMany({
      where: { firmId: actor.firmId, id: { in: [...new Set(input.items.map((i) => i.garmentTypeId))] } },
      select: { id: true, name: true, isActive: true, trackingCategory: true },
    }),
  ]);

  const serviceById = new Map(services.map((s) => [s.id, s]));
  const garmentTypeById = new Map(garmentTypes.map((g) => [g.id, g]));

  for (const item of input.items) {
    const service = serviceById.get(item.serviceId);
    if (!service) throw new BusinessRuleError("One of the selected services no longer exists");
    if (!service.isActive) throw new BusinessRuleError(`${service.name} is not currently offered`);
    const garmentType = garmentTypeById.get(item.garmentTypeId);
    if (!garmentType) throw new BusinessRuleError("One of the selected garment types no longer exists");
    if (!garmentType.isActive) throw new BusinessRuleError(`${garmentType.name} is no longer accepted`);
  }

  // Price every line before opening the transaction — rate lookups are reads.
  const priced = await Promise.all(
    input.items.map(async (item) => {
      const resolved = await resolvePrice({
        serviceId: item.serviceId,
        garmentTypeId: item.garmentTypeId,
        quantity: item.quantity,
        weightKg: item.weightKg,
        b2bAccountId: input.b2bAccountId ?? null,
      });

      const useOverride =
        actor.canOverridePrice &&
        item.unitPriceOverride !== null &&
        item.unitPriceOverride !== undefined;

      const unitPrice = useOverride ? round2(item.unitPriceOverride!) : resolved.unitPrice;
      const billableUnits =
        resolved.pricingMode === "PER_KG"
          ? item.weightKg
          : resolved.pricingMode === "FLAT"
            ? 1
            : item.quantity;

      if (resolved.pricingMode === "PER_KG" && item.weightKg <= 0) {
        throw new BusinessRuleError(
          `${serviceById.get(item.serviceId)?.name ?? "This service"} is charged by weight — enter the weight`,
        );
      }

      return {
        ...item,
        pricingMode: resolved.pricingMode,
        unitPrice,
        lineTotal: round2(unitPrice * billableUnits),
      };
    }),
  );

  const subtotal = round2(priced.reduce((sum, item) => sum + item.lineTotal, 0));
  const totals = computeTotals({
    subtotal,
    discountAmount: input.discountAmount,
    gstRate: input.gstRate,
  });

  if (input.advanceAmount > totals.totalAmount) {
    throw new BusinessRuleError("The advance cannot exceed the order total");
  }

  const totalPieces = priced.reduce((sum, item) => sum + item.quantity, 0);
  const totalWeightKg = round3(priced.reduce((sum, item) => sum + item.weightKg, 0));

  if (input.b2bAccountId) {
    await assertCreditAvailable(input.b2bAccountId, totals.totalAmount - input.advanceAmount);
  }

  const result = await prisma.$transaction(
    async (tx) => {
      const orderNumber = await nextOrderNumber(tx);
      const outstanding = round2(totals.totalAmount - input.advanceAmount);

      // Every order belongs to a directory entry; walk-ins create one on the
      // spot so the counter can find them again by phone next time.
      const customer = await upsertCustomer(tx, {
        branchId: input.branchId,
        firmId: actor.firmId,
        createdById: actor.userId,
        details: {
          name: input.customerName,
          phone: input.customerPhone,
          email: input.customerEmail,
          addressLine: input.addressLine,
          city: input.city,
          pincode: input.pincode,
          landmark: input.landmark,
        },
      });

      const order = await tx.order.create({
        data: {
          orderNumber,
          branchId: input.branchId,
          firmId: actor.firmId,
          type: input.type,
          priority: input.priority,
          status: "RECEIVED",
          paymentStatus: derivePaymentStatus(totals.totalAmount, input.advanceAmount),
          customerName: input.customerName,
          customerPhone: input.customerPhone,
          customerEmail: input.customerEmail ?? null,
          addressLine: input.addressLine ?? null,
          city: input.city ?? null,
          pincode: input.pincode ?? null,
          landmark: input.landmark ?? null,
          customerId: customer.id,
          b2bAccountId: input.b2bAccountId ?? null,
          expectedDeliveryAt: input.expectedDeliveryAt,
          subtotal: totals.subtotal,
          discountAmount: totals.discountAmount,
          discountReason: input.discountReason ?? null,
          taxableAmount: totals.taxableAmount,
          gstRate: totals.gstRate,
          gstAmount: totals.gstAmount,
          totalAmount: totals.totalAmount,
          paidAmount: input.advanceAmount,
          outstandingAmount: outstanding,
          totalPieces,
          totalWeightKg,
          specialInstructions: input.specialInstructions ?? null,
          stainNotes: input.stainNotes ?? null,
          damageNotes: input.damageNotes ?? null,
          createdById: actor.userId,
          items: {
            create: priced.map((item) => ({
              serviceId: item.serviceId,
              garmentTypeId: item.garmentTypeId,
              quantity: item.quantity,
              weightKg: item.weightKg,
              pricingMode: item.pricingMode,
              unitPrice: item.unitPrice,
              lineTotal: item.lineTotal,
              notes: item.notes ?? null,
            })),
          },
          statusHistory: {
            create: {
              toStatus: "RECEIVED",
              userId: actor.userId,
              userName: actor.userName,
              note: "Order booked at counter",
            },
          },
        },
        include: { items: true },
      });

      // One tracked garment per physical piece.
      const seeds: GarmentSeed[] = [];
      for (const [index, orderItem] of order.items.entries()) {
        const source = priced[index];
        const service = serviceById.get(orderItem.serviceId)!;
        for (let piece = 0; piece < orderItem.quantity; piece += 1) {
          seeds.push({
            orderItemId: orderItem.id,
            garmentTypeId: orderItem.garmentTypeId,
            trackingCategory:
              garmentTypeById.get(orderItem.garmentTypeId)?.trackingCategory ?? "OTHER",
            serviceId: orderItem.serviceId,
            serviceStages: service.stages,
            stainNotes: source.notes ?? input.stainNotes ?? null,
            damageNotes: input.damageNotes ?? null,
          });
        }
      }

      await createGarments(tx, {
        orderId: order.id,
        branchId: input.branchId,
        seeds,
        actor,
      });

      const branch = await tx.branch.findUnique({
        where: { id: input.branchId },
        select: { gstNumber: true, state: true, addressLine: true, city: true },
      });

      const gstSplit = splitGst(totals.gstAmount, false);
      const invoiceNumber = await nextInvoiceNumber(tx);

      await tx.invoice.create({
        data: {
          invoiceNumber,
          type: "ORDER",
          status: input.advanceAmount >= totals.totalAmount ? "PAID" : "ISSUED",
          branchId: input.branchId,
          firmId: actor.firmId,
          orderId: order.id,
          b2bAccountId: input.b2bAccountId ?? null,
          billToName: input.customerName,
          billToPhone: input.customerPhone,
          billToEmail: input.customerEmail ?? null,
          billToAddress: input.addressLine ?? null,
          subtotal: totals.subtotal,
          discountAmount: totals.discountAmount,
          taxableAmount: totals.taxableAmount,
          gstRate: totals.gstRate,
          cgstAmount: gstSplit.cgstAmount,
          sgstAmount: gstSplit.sgstAmount,
          igstAmount: gstSplit.igstAmount,
          totalAmount: totals.totalAmount,
          amountPaid: input.advanceAmount,
          amountDue: outstanding,
          dueAt: input.expectedDeliveryAt,
          issuedById: actor.userId,
          lines: {
            create: order.items.map((item) => {
              const service = serviceById.get(item.serviceId)!;
              const garmentType = garmentTypeById.get(item.garmentTypeId)!;
              return {
                orderId: order.id,
                description: `${service.name} — ${garmentType.name}`,
                quantity:
                  item.pricingMode === "PER_KG"
                    ? num(item.weightKg)
                    : item.pricingMode === "FLAT"
                      ? 1
                      : item.quantity,
                unitPrice: num(item.unitPrice),
                lineTotal: num(item.lineTotal),
              };
            }),
          },
        },
      });

      if (input.advanceAmount > 0) {
        await tx.payment.create({
          data: {
            paymentNumber: await nextPaymentNumber(tx),
            branchId: input.branchId,
            firmId: actor.firmId,
            orderId: order.id,
            amount: input.advanceAmount,
            method: input.advanceMethod,
            provider: "MANUAL",
            state: "CAPTURED",
            isAdvance: true,
            receivedById: actor.userId,
            notes: "Advance collected at booking",
          },
        });
      }

      if (input.type === "PICKUP") {
        await tx.pickup.create({
          data: {
            pickupNumber: await nextPickupNumber(tx),
            orderId: order.id,
            branchId: input.branchId,
            status: "REQUESTED",
            scheduledAt: input.pickupScheduledAt ?? new Date(),
            contactName: input.customerName,
            contactPhone: input.customerPhone,
            addressLine: input.addressLine ?? "",
            landmark: input.landmark ?? null,
          },
        });
      }

      if (input.b2bAccountId) {
        await tx.b2BAccount.update({
          where: { id: input.b2bAccountId },
          data: { outstandingBalance: { increment: outstanding } },
        });
      }

      await recalcCustomerRollup(tx, customer.id);

      return {
        id: order.id,
        orderNumber: order.orderNumber,
        totalAmount: totals.totalAmount,
        garmentCount: seeds.length,
        customerId: customer.id,
      };
    },
    { timeout: 30_000 },
  );

  await notify({
    event: "ORDER_RECEIVED",
    orderId: result.id,
    branchId: input.branchId,
    recipientName: input.customerName,
    recipientPhone: input.customerPhone,
    recipientEmail: input.customerEmail ?? null,
    variables: {
      customerName: input.customerName,
      orderNumber: result.orderNumber,
      pieces: totalPieces,
      total: formatCurrency(totals.totalAmount),
      outstanding: formatCurrency(totals.totalAmount - input.advanceAmount),
      expectedDelivery: formatDate(input.expectedDeliveryAt),
    },
  });

  return result;
}

/** Blocks a credit order that would push a corporate account past its limit. */
async function assertCreditAvailable(accountId: string, additional: number) {
  const account = await prisma.b2BAccount.findUnique({
    where: { id: accountId },
    select: { creditLimit: true, outstandingBalance: true, businessName: true, isActive: true },
  });

  if (!account) throw new NotFoundError("Corporate account not found");
  if (!account.isActive) {
    throw new BusinessRuleError(`${account.businessName} is not active`);
  }

  const limit = num(account.creditLimit);
  if (limit <= 0) return;

  const projected = num(account.outstandingBalance) + additional;
  if (projected > limit) {
    throw new BusinessRuleError(
      `This order would take ${account.businessName} past its ${formatCurrency(limit)} credit limit (outstanding would be ${formatCurrency(projected)})`,
    );
  }
}

/** Re-derives an order's money columns from its payments and refunds. */
export async function recalcOrderPayments(tx: Tx, orderId: string): Promise<void> {
  const [order, paymentAgg, refundAgg] = await Promise.all([
    tx.order.findUnique({
      where: { id: orderId },
      select: {
        totalAmount: true,
        b2bAccountId: true,
        outstandingAmount: true,
        customerId: true,
      },
    }),
    tx.payment.aggregate({
      where: { orderId, state: "CAPTURED" },
      _sum: { amount: true },
    }),
    tx.refund.aggregate({
      where: { orderId, status: "PROCESSED" },
      _sum: { amount: true },
    }),
  ]);

  if (!order) return;

  const total = num(order.totalAmount);
  const paid = num(paymentAgg._sum.amount);
  const refunded = num(refundAgg._sum.amount);
  const outstanding = round2(Math.max(0, total - paid));

  await tx.order.update({
    where: { id: orderId },
    data: {
      paidAmount: paid,
      refundedAmount: refunded,
      outstandingAmount: outstanding,
      paymentStatus: derivePaymentStatus(total, paid, refunded),
    },
  });

  if (order.b2bAccountId) {
    const delta = round2(outstanding - num(order.outstandingAmount));
    if (delta !== 0) {
      await tx.b2BAccount.update({
        where: { id: order.b2bAccountId },
        data: { outstandingBalance: { increment: delta } },
      });
    }
  }

  const invoice = await tx.invoice.findFirst({
    where: { orderId },
    select: { id: true, totalAmount: true },
  });

  if (invoice) {
    const invoiceTotal = num(invoice.totalAmount);
    const due = round2(Math.max(0, invoiceTotal - paid));
    await tx.invoice.update({
      where: { id: invoice.id },
      data: {
        amountPaid: paid,
        amountDue: due,
        status: due <= 0 ? "PAID" : paid > 0 ? "PARTIALLY_PAID" : "ISSUED",
      },
    });
  }

  if (order.customerId) {
    await recalcCustomerRollup(tx, order.customerId);
  }
}

/** Recomputes subtotal/GST/total after line items or discounts change. */
export async function recalcOrderTotals(tx: Tx, orderId: string): Promise<void> {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    include: { items: true },
  });
  if (!order) return;

  const subtotal = round2(
    order.items.reduce((sum, item) => sum + num(item.lineTotal), 0),
  );
  const totals = computeTotals({
    subtotal,
    discountAmount: num(order.discountAmount),
    gstRate: num(order.gstRate),
  });

  await tx.order.update({
    where: { id: orderId },
    data: {
      subtotal: totals.subtotal,
      discountAmount: totals.discountAmount,
      taxableAmount: totals.taxableAmount,
      gstAmount: totals.gstAmount,
      totalAmount: totals.totalAmount,
      totalPieces: order.items.reduce((sum, item) => sum + item.quantity, 0),
      totalWeightKg: round3(
        order.items.reduce((sum, item) => sum + num(item.weightKg), 0),
      ),
    },
  });

  const invoice = await tx.invoice.findFirst({
    where: { orderId },
    select: { id: true },
  });

  if (invoice) {
    const gstSplit = splitGst(totals.gstAmount, false);
    await tx.invoice.update({
      where: { id: invoice.id },
      data: {
        subtotal: totals.subtotal,
        discountAmount: totals.discountAmount,
        taxableAmount: totals.taxableAmount,
        cgstAmount: gstSplit.cgstAmount,
        sgstAmount: gstSplit.sgstAmount,
        igstAmount: gstSplit.igstAmount,
        totalAmount: totals.totalAmount,
      },
    });
  }

  await recalcOrderPayments(tx, orderId);
}

/** Records a manual order status change with its audit trail entry. */
export async function setOrderStatus(
  tx: Tx,
  params: {
    orderId: string;
    status: OrderStatus;
    actor: ActorContext;
    note?: string | null;
  },
): Promise<void> {
  const order = await tx.order.findUnique({
    where: { id: params.orderId },
    select: { status: true, readyAt: true, deliveredAt: true, customerId: true },
  });
  if (!order) throw new NotFoundError("Order not found");
  if (order.status === params.status) return;

  await tx.order.update({
    where: { id: params.orderId },
    data: {
      status: params.status,
      readyAt: params.status === "READY" && !order.readyAt ? new Date() : order.readyAt,
      deliveredAt:
        params.status === "DELIVERED" && !order.deliveredAt
          ? new Date()
          : order.deliveredAt,
    },
  });

  await tx.orderStatusHistory.create({
    data: {
      orderId: params.orderId,
      fromStatus: order.status,
      toStatus: params.status,
      userId: params.actor.userId,
      userName: params.actor.userName,
      note: params.note ?? null,
    },
  });

  // Cancelling drops the order out of the customer's lifetime figures.
  if (order.customerId && (params.status === "CANCELLED" || order.status === "CANCELLED")) {
    await recalcCustomerRollup(tx, order.customerId);
  }
}
