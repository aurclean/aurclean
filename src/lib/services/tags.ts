import "server-only";
import { prisma } from "@/lib/prisma";
import { NotFoundError } from "@/lib/action-result";
import { num } from "@/lib/money";
import { buildBarcodeValue, buildOrderQrPayload } from "@/lib/codes";
import { ORDER_STATUS_LABELS } from "@/lib/workflow";

/** Everything a thermal tag or receipt prints, flattened and serialisable. */
export interface TagSheet {
  orderId: string;
  orderNumber: string;
  orderQr: string;
  orderBarcode: string;
  businessName: string;
  branchName: string;
  branchCode: string;
  branchPhone: string | null;
  branchAddress: string | null;
  gstNumber: string | null;
  customerName: string;
  customerPhone: string;
  status: string;
  statusLabel: string;
  priority: string;
  placedAt: string;
  expectedDeliveryAt: string;
  itemCount: number;
  pieceCount: number;
  items: Array<{
    id: string;
    label: string;
    serviceName: string;
    garmentTypeName: string;
    quantity: number;
    weightKg: number;
    unitPrice: number;
    lineTotal: number;
  }>;
  subtotal: number;
  discountAmount: number;
  gstRate: number;
  gstAmount: number;
  totalAmount: number;
  paidAmount: number;
  outstandingAmount: number;
  paymentStatus: string;
  specialInstructions: string | null;
  tagPrintCount: number;
  tagLastPrintedAt: string | null;
  garments: Array<{
    id: string;
    garmentCode: string;
    qrPayload: string;
    barcodeValue: string;
    garmentTypeName: string;
    serviceName: string;
    statusLabel: string;
  }>;
  payments: Array<{
    id: string;
    paymentNumber: string;
    amount: number;
    method: string;
    reference: string | null;
    paidAt: string;
  }>;
}

export async function getTagSheet(orderId: string): Promise<TagSheet> {
  const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        branch: {
          select: {
            name: true,
            code: true,
            phone: true,
            addressLine: true,
            city: true,
            pincode: true,
            gstNumber: true,
          },
        },
        items: {
          include: {
            service: { select: { name: true } },
            garmentType: { select: { name: true } },
          },
        },
        garments: {
          orderBy: { garmentCode: "asc" },
          include: {
            garmentType: { select: { name: true } },
            service: { select: { name: true } },
          },
        },
        payments: {
          where: { state: "CAPTURED" },
          orderBy: { paidAt: "asc" },
          select: {
            id: true,
            paymentNumber: true,
            amount: true,
            method: true,
            reference: true,
            paidAt: true,
          },
        },
      },
    });

  if (!order) throw new NotFoundError("Order not found");

  const [appName, firm] = await Promise.all([
    prisma.setting.findUnique({
      where: { firmId_key: { firmId: order.firmId, key: "app_name" } },
    }),
    prisma.firm.findUnique({ where: { id: order.firmId }, select: { name: true } }),
  ]);

  const branchAddress = [order.branch.addressLine, order.branch.city, order.branch.pincode]
    .filter(Boolean)
    .join(", ");

  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    orderQr: buildOrderQrPayload(order.orderNumber),
    orderBarcode: buildBarcodeValue(order.orderNumber),
    businessName: appName?.value || firm?.name || "",
    branchName: order.branch.name,
    branchCode: order.branch.code,
    branchPhone: order.branch.phone,
    branchAddress: branchAddress || null,
    gstNumber: order.branch.gstNumber,
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    status: order.status,
    statusLabel: ORDER_STATUS_LABELS[order.status],
    priority: order.priority,
    placedAt: order.placedAt.toISOString(),
    expectedDeliveryAt: order.expectedDeliveryAt.toISOString(),
    itemCount: order.items.length,
    pieceCount: order.totalPieces,
    items: order.items.map((item) => ({
      id: item.id,
      label: `${item.garmentType.name} · ${item.service.name}`,
      serviceName: item.service.name,
      garmentTypeName: item.garmentType.name,
      quantity: item.quantity,
      weightKg: num(item.weightKg),
      unitPrice: num(item.unitPrice),
      lineTotal: num(item.lineTotal),
    })),
    subtotal: num(order.subtotal),
    discountAmount: num(order.discountAmount),
    gstRate: num(order.gstRate),
    gstAmount: num(order.gstAmount),
    totalAmount: num(order.totalAmount),
    paidAmount: num(order.paidAmount),
    outstandingAmount: num(order.outstandingAmount),
    paymentStatus: order.paymentStatus,
    specialInstructions: order.specialInstructions,
    tagPrintCount: order.tagPrintCount,
    tagLastPrintedAt: order.tagLastPrintedAt?.toISOString() ?? null,
    garments: order.garments.map((garment) => ({
      id: garment.id,
      garmentCode: garment.garmentCode,
      qrPayload: garment.qrPayload,
      barcodeValue: garment.barcodeValue,
      garmentTypeName: garment.garmentType.name,
      serviceName: garment.service.name,
      statusLabel: garment.status,
    })),
    payments: order.payments.map((payment) => ({
      id: payment.id,
      paymentNumber: payment.paymentNumber,
      amount: num(payment.amount),
      method: payment.method,
      reference: payment.reference,
      paidAt: payment.paidAt.toISOString(),
    })),
  };
}
