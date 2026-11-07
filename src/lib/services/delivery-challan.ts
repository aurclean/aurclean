import "server-only";

import { prisma } from "@/lib/prisma";
import { nextChallanNumber, nextPaymentNumber } from "@/lib/sequence";
import { recordAudit } from "@/lib/audit";
import { recalcOrderPayments } from "@/lib/services/orders";
import { AuthorizationError } from "@/lib/session";
import type { ChallanStatus, PaymentStatus, Prisma } from "@/generated/prisma/client";

export interface CreateDeliveryChallanParams {
  orderId: string;
  notes?: string;
  terms?: string;
  deliveredByName?: string;
  receivedByName?: string;
  garmentIds?: string[];
  userId?: string;
  userBranchId?: string;
  /** The caller's own firm — the order must belong to it. */
  firmId: string;
}

export interface GetDeliveryChallansParams {
  firmId: string;
  page?: number;
  limit?: number;
  search?: string;
  status?: ChallanStatus | "ALL";
  paymentStatus?: PaymentStatus | "ALL";
  customerId?: string;
  branchId?: string;
  dateFrom?: string;
  dateTo?: string;
  sortBy?: "createdAt" | "challanNumber" | "deliveryDate" | "grandTotal";
  sortOrder?: "asc" | "desc";
}

/**
 * Creates a new official Delivery Challan linked to an Order.
 * Automatically pulls customer info, garments, prices, and totals from the order.
 */
export async function createDeliveryChallan(params: CreateDeliveryChallanParams) {
  const { orderId, notes, terms, deliveredByName, receivedByName, garmentIds, userId, userBranchId, firmId } = params;

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      branch: true,
      customer: true,
      items: {
        include: {
          garmentType: true,
          service: true,
        },
      },
      garments: {
        include: {
          garmentType: true,
          service: true,
        },
      },
      deliveryChallans: {
        where: { status: { not: "CANCELLED" } },
      },
    },
  });

  if (!order) {
    throw new Error(`Order #${orderId} not found.`);
  }
  if (order.firmId !== firmId) {
    throw new AuthorizationError("This record belongs to a different organization");
  }

  if (order.status === "CANCELLED" || order.status === "REFUNDED") {
    throw new Error(`Cannot create a Delivery Challan for a ${order.status.toLowerCase()} order.`);
  }

  // Determine garments to include in this challan
  let selectedGarments = order.garments;
  if (garmentIds && garmentIds.length > 0) {
    selectedGarments = order.garments.filter((g) => garmentIds.includes(g.id));
  }

  if (selectedGarments.length === 0) {
    throw new Error("No valid garments selected for this Delivery Challan.");
  }

  // Calculate pricing breakdown
  const orderSubtotal = Number(order.subtotal);
  const orderTotalPieces = order.garments.length || 1;
  const ratio = selectedGarments.length / orderTotalPieces;

  const challanSubtotal = Math.round(orderSubtotal * ratio * 100) / 100;
  const challanDiscount = Math.round(Number(order.discountAmount) * ratio * 100) / 100;
  const challanTaxable = Math.round(Number(order.taxableAmount) * ratio * 100) / 100;
  const challanGst = Math.round(Number(order.gstAmount) * ratio * 100) / 100;
  const challanGrandTotal = Math.round(Number(order.totalAmount) * ratio * 100) / 100;
  const challanPaid = Math.min(Number(order.paidAmount), challanGrandTotal);
  const challanBalance = Math.max(0, challanGrandTotal - challanPaid);

  const challanNumber = await nextChallanNumber();

  // Determine initial status
  const isPartial = selectedGarments.length < order.garments.length;
  const initialStatus: ChallanStatus = isPartial ? "PARTIALLY_DELIVERED" : "GENERATED";

  const result = await prisma.$transaction(async (tx) => {
    const challan = await tx.deliveryChallan.create({
      data: {
        challanNumber,
        orderId: order.id,
        branchId: order.branchId,
        firmId: order.firmId,
        customerId: order.customerId,
        customerName: order.customerName,
        customerPhone: order.customerPhone,
        customerAddress: order.addressLine || order.customer?.addressLine || null,
        challanDate: new Date(),
        deliveryDate: order.deliveredAt || new Date(),
        expectedDeliveryDate: order.expectedDeliveryAt,
        status: initialStatus,
        paymentStatus: order.paymentStatus,
        subtotal: challanSubtotal,
        discountAmount: challanDiscount,
        taxableAmount: challanTaxable,
        gstRate: order.gstRate,
        gstAmount: challanGst,
        grandTotal: challanGrandTotal,
        paidAmount: challanPaid,
        balanceAmount: challanBalance,
        notes: notes || order.specialInstructions || null,
        terms:
          terms ||
          "No guarantee against colour loss, bleeding & shrinkage.\nIn case of rare damage, the company's liability shall be limited to a maximum of eight (8) times the processing (laundry/dry clean) cost.",
        deliveredByName: deliveredByName || null,
        receivedByName: receivedByName || order.customerName,
        createdById: userId || null,
        items: {
          create: selectedGarments.map((g) => {
            // Find unit price from order items matching garmentType & service
            const matchingItem = order.items.find(
              (item) => item.garmentTypeId === g.garmentTypeId && item.serviceId === g.serviceId,
            );
            const unitPrice = matchingItem ? Number(matchingItem.unitPrice) : Math.round(challanSubtotal / selectedGarments.length);

            return {
              garmentId: g.id,
              garmentCode: g.garmentCode,
              category: g.garmentType.name,
              description: [g.color, g.brand, g.garmentType.name].filter(Boolean).join(" "),
              service: g.service.name,
              quantity: 1,
              unitPrice,
              amount: unitPrice,
              status: g.status,
            };
          }),
        },
        statusHistory: {
          create: {
            fromStatus: null,
            toStatus: initialStatus,
            userId: userId || null,
            userName: userId ? undefined : "System",
            note: isPartial ? `Delivery Challan generated for ${selectedGarments.length} of ${order.garments.length} garments.` : "Delivery Challan generated.",
          },
        },
      },
      include: {
        items: true,
        order: true,
        customer: true,
        branch: true,
        statusHistory: true,
      },
    });

    return challan;
  });

  if (userId) {
    await recordAudit({
      userId,
      branchId: order.branchId,
      action: "DELIVERY_CHALLAN_CREATED",
      entity: "DeliveryChallan",
      entityId: result.id,
      summary: `Created Delivery Challan ${result.challanNumber} for Order ${order.orderNumber} (${selectedGarments.length} garments)`,
    });
  }

  return result;
}

/**
 * Fetches Delivery Challans with search, filtering, and pagination.
 */
export async function getDeliveryChallans(params: GetDeliveryChallansParams) {
  const {
    firmId,
    page = 1,
    limit = 20,
    search,
    status = "ALL",
    paymentStatus = "ALL",
    customerId,
    branchId,
    dateFrom,
    dateTo,
    sortBy = "createdAt",
    sortOrder = "desc",
  } = params;

  const where: Prisma.DeliveryChallanWhereInput = { firmId };

  if (branchId) {
    where.branchId = branchId;
  }

  if (customerId) {
    where.customerId = customerId;
  }

  if (status !== "ALL") {
    where.status = status;
  }

  if (paymentStatus !== "ALL") {
    where.paymentStatus = paymentStatus;
  }

  if (dateFrom || dateTo) {
    where.challanDate = {};
    if (dateFrom) where.challanDate.gte = new Date(dateFrom);
    if (dateTo) {
      const end = new Date(dateTo);
      end.setHours(23, 59, 59, 999);
      where.challanDate.lte = end;
    }
  }

  if (search && search.trim()) {
    const q = search.trim();
    where.OR = [
      { challanNumber: { contains: q, mode: "insensitive" } },
      { customerName: { contains: q, mode: "insensitive" } },
      { customerPhone: { contains: q, mode: "insensitive" } },
      { order: { orderNumber: { contains: q, mode: "insensitive" } } },
    ];
  }

  const [challans, total] = await Promise.all([
    prisma.deliveryChallan.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { [sortBy]: sortOrder },
      include: {
        order: {
          select: {
            id: true,
            orderNumber: true,
            totalPieces: true,
            status: true,
          },
        },
        items: true,
        branch: { select: { id: true, name: true, code: true } },
        createdBy: { select: { id: true, name: true } },
      },
    }),
    prisma.deliveryChallan.count({ where }),
  ]);

  return {
    challans,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit) || 1,
    },
  };
}

/**
 * Fetches complete details of a single Delivery Challan by ID.
 */
export async function getDeliveryChallanById(id: string) {
  const challan = await prisma.deliveryChallan.findFirst({
    where: { OR: [{ id }, { challanNumber: id }] },
    include: {
      branch: true,
      customer: true,
      order: {
        include: {
          garments: {
            include: {
              garmentType: true,
              service: true,
            },
          },
          payments: true,
        },
      },
      items: {
        include: {
          garment: {
            include: {
              garmentType: true,
              service: true,
            },
          },
        },
      },
      statusHistory: {
        orderBy: { createdAt: "desc" },
      },
      createdBy: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
  });

  return challan;
}

/**
 * Updates status of a Delivery Challan (e.g. Generated -> Ready -> Delivered).
 * Handles partial delivery and order status sync automatically.
 */
export async function updateChallanStatus(
  id: string,
  toStatus: ChallanStatus,
  options: {
    note?: string;
    deliveredByName?: string;
    receivedByName?: string;
    paymentAmount?: number;
    paymentMethod?: any;
    userId?: string;
    /** The caller's own firm — the challan must belong to it. */
    firmId: string;
  },
) {
  const { note, deliveredByName, receivedByName, paymentAmount, paymentMethod, userId, firmId } = options;

  const challan = await prisma.deliveryChallan.findUnique({
    where: { id },
    include: {
      items: true,
      order: {
        include: {
          garments: true,
        },
      },
    },
  });

  if (!challan) {
    throw new Error(`Delivery Challan #${id} not found.`);
  }
  if (challan.firmId !== firmId) {
    throw new AuthorizationError("This record belongs to a different organization");
  }

  if (challan.status === "CANCELLED") {
    throw new Error("Cannot modify a cancelled Delivery Challan.");
  }

  if (challan.status === toStatus) {
    return challan;
  }

  const fromStatus = challan.status;

  const updatedChallan = await prisma.$transaction(async (tx) => {
    // Collect payment if provided
    let newPaid = Number(challan.paidAmount);
    let newBalance = Number(challan.balanceAmount);

    if (paymentAmount && paymentAmount > 0 && userId) {
      const paymentNumber = await nextPaymentNumber(tx);
      await tx.payment.create({
        data: {
          paymentNumber,
          branchId: challan.branchId,
          firmId: challan.firmId,
          orderId: challan.orderId,
          amount: paymentAmount,
          method: paymentMethod || "CASH",
          provider: "MANUAL",
          state: "CAPTURED",
          notes: `Payment collected upon delivery of Challan ${challan.challanNumber}`,
          receivedById: userId,
        },
      });

      await recalcOrderPayments(tx, challan.orderId);

      newPaid += paymentAmount;
      newBalance = Math.max(0, newBalance - paymentAmount);
    }

    const updated = await tx.deliveryChallan.update({
      where: { id },
      data: {
        status: toStatus,
        deliveryDate: toStatus === "DELIVERED" ? new Date() : challan.deliveryDate,
        deliveredByName: deliveredByName || challan.deliveredByName,
        receivedByName: receivedByName || challan.receivedByName,
        paidAmount: newPaid,
        balanceAmount: newBalance,
        paymentStatus: newBalance <= 0 ? "PAID" : newPaid > 0 ? "PARTIALLY_PAID" : challan.paymentStatus,
        statusHistory: {
          create: {
            fromStatus,
            toStatus,
            userId: userId || null,
            note: note || `Challan status updated to ${toStatus.replace(/_/g, " ")}.`,
          },
        },
      },
      include: {
        items: true,
        order: true,
        customer: true,
        branch: true,
      },
    });

    // If marked DELIVERED or PARTIALLY_DELIVERED, update garment states
    if (toStatus === "DELIVERED" || toStatus === "PARTIALLY_DELIVERED") {
      const garmentIdsToDeliver = challan.items.map((it) => it.garmentId).filter((gid): gid is string => !!gid);

      if (garmentIdsToDeliver.length > 0) {
        await tx.garment.updateMany({
          where: { id: { in: garmentIdsToDeliver } },
          data: {
            status: "DELIVERED",
            deliveredAt: new Date(),
          },
        });
      }

      // Check total garments delivered for this order
      const allOrderGarments = await tx.garment.findMany({
        where: { orderId: challan.orderId },
        select: { id: true, status: true },
      });

      const totalDelivered = allOrderGarments.filter((g) => g.status === "DELIVERED").length;
      const isAllDelivered = totalDelivered === allOrderGarments.length;

      await tx.order.update({
        where: { id: challan.orderId },
        data: {
          status: isAllDelivered ? "DELIVERED" : "PARTIALLY_DELIVERED",
          deliveredAt: isAllDelivered ? new Date() : undefined,
        },
      });
    }

    return updated;
  });

  if (userId) {
    await recordAudit({
      userId,
      branchId: challan.branchId,
      action: "DELIVERY_CHALLAN_STATUS_UPDATED",
      entity: "DeliveryChallan",
      entityId: id,
      summary: `Updated Delivery Challan ${challan.challanNumber} status from ${fromStatus} to ${toStatus}`,
    });
  }

  return updatedChallan;
}

/**
 * Cancels a Delivery Challan with a required reason.
 */
export async function cancelDeliveryChallan(id: string, reason: string, userId: string | undefined, firmId: string) {
  const challan = await prisma.deliveryChallan.findUnique({
    where: { id },
  });

  if (!challan) {
    throw new Error(`Delivery Challan #${id} not found.`);
  }
  if (challan.firmId !== firmId) {
    throw new AuthorizationError("This record belongs to a different organization");
  }

  if (challan.status === "DELIVERED") {
    throw new Error("Delivered challans cannot be cancelled.");
  }

  const updated = await prisma.deliveryChallan.update({
    where: { id },
    data: {
      status: "CANCELLED",
      notes: challan.notes ? `${challan.notes}\n[CANCELLED]: ${reason}` : `[CANCELLED]: ${reason}`,
      statusHistory: {
        create: {
          fromStatus: challan.status,
          toStatus: "CANCELLED",
          userId: userId || null,
          note: `Challan cancelled. Reason: ${reason}`,
        },
      },
    },
    include: {
      items: true,
      order: true,
      customer: true,
    },
  });

  if (userId) {
    await recordAudit({
      userId,
      branchId: challan.branchId,
      action: "DELIVERY_CHALLAN_CANCELLED",
      entity: "DeliveryChallan",
      entityId: id,
      summary: `Cancelled Delivery Challan ${challan.challanNumber}: ${reason}`,
    });
  }

  return updated;
}

/**
 * Calculates Delivery Challan statistics for Dashboard and Module views.
 */
export async function getChallanStats(firmId: string, branchId?: string) {
  const where: Prisma.DeliveryChallanWhereInput = { firmId, ...(branchId ? { branchId } : {}) };

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);

  const [todaysChallans, pendingDelivery, partiallyDelivered, deliveredToday] = await Promise.all([
    prisma.deliveryChallan.count({
      where: {
        ...where,
        createdAt: { gte: todayStart, lte: todayEnd },
      },
    }),
    prisma.deliveryChallan.count({
      where: {
        ...where,
        status: { in: ["DRAFT", "GENERATED", "READY_FOR_DELIVERY"] },
      },
    }),
    prisma.deliveryChallan.count({
      where: {
        ...where,
        status: "PARTIALLY_DELIVERED",
      },
    }),
    prisma.deliveryChallan.count({
      where: {
        ...where,
        status: "DELIVERED",
        deliveryDate: { gte: todayStart, lte: todayEnd },
      },
    }),
  ]);

  return {
    todaysChallans,
    pendingDelivery,
    partiallyDelivered,
    deliveredToday,
  };
}
