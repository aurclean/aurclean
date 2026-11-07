"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

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
import { formatCurrency, num, round2, round3 } from "@/lib/money";
import {
  nextGoodsReceiptNumber,
  nextPurchaseOrderNumber,
  nextPurchaseReturnNumber,
  nextSupplierPaymentNumber,
} from "@/lib/sequence";
import { applyStockMovement } from "@/lib/services/inventory";
import { cuidSchema } from "@/lib/validations/common";
import {
  purchaseOrderSchema,
  purchaseReturnSchema,
  receiveGoodsSchema,
  supplierPaymentSchema,
  supplierSchema,
} from "@/lib/validations/purchase";

export async function saveSupplierAction(
  payload: unknown,
): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const user = await authorize(PERMISSIONS.PURCHASE_MANAGE);
    const input = supplierSchema.parse(payload);

    if (input.id) {
      const existing = await prisma.supplier.findUnique({
        where: { id: input.id },
        select: { firmId: true },
      });
      if (!existing) throw new NotFoundError("Supplier not found");
      assertFirmAccess(user, existing.firmId);
    }

    const supplier = input.id
      ? await prisma.supplier.update({
          where: { id: input.id },
          data: {
            code: input.code,
            name: input.name,
            contactPerson: input.contactPerson ?? null,
            phone: input.phone ?? null,
            email: input.email ?? null,
            addressLine: input.addressLine ?? null,
            gstNumber: input.gstNumber ?? null,
            paymentTerms: input.paymentTerms ?? null,
            creditDays: input.creditDays,
            isActive: input.isActive,
          },
        })
      : await prisma.supplier.create({
          data: {
            code: input.code,
            name: input.name,
            firmId: requireFirmId(user),
            contactPerson: input.contactPerson ?? null,
            phone: input.phone ?? null,
            email: input.email ?? null,
            addressLine: input.addressLine ?? null,
            gstNumber: input.gstNumber ?? null,
            paymentTerms: input.paymentTerms ?? null,
            creditDays: input.creditDays,
            isActive: input.isActive,
          },
        });

    await recordAudit({
      userId: user.id,
      branchId: user.branchId,
      action: input.id ? "SUPPLIER_UPDATED" : "SUPPLIER_CREATED",
      entity: "Supplier",
      entityId: supplier.id,
      summary: `${supplier.code} — ${supplier.name}`,
    });

    revalidatePath("/purchases");
    return { id: supplier.id };
  });
}

export async function createPurchaseOrderAction(
  payload: unknown,
): Promise<ActionResult<{ id: string; poNumber: string }>> {
  return runAction(async () => {
    const user = await authorize(PERMISSIONS.PURCHASE_MANAGE);
    const input = purchaseOrderSchema.parse(payload);
    const branchId = await requireWriteBranch(user, input.branchId);

    const supplier = await prisma.supplier.findUnique({
      where: { id: input.supplierId },
      select: { id: true, firmId: true, name: true, isActive: true },
    });
    if (!supplier) throw new NotFoundError("Supplier not found");
    assertFirmAccess(user, supplier.firmId);
    if (!supplier.isActive) throw new BusinessRuleError(`${supplier.name} is not active`);

    const lines = input.items.map((item) => {
      const base = round2(item.quantity * item.unitPrice);
      const tax = round2((base * item.taxRate) / 100);
      return { ...item, base, tax, lineTotal: round2(base + tax) };
    });

    const subtotal = round2(lines.reduce((sum, line) => sum + line.base, 0));
    const taxAmount = round2(lines.reduce((sum, line) => sum + line.tax, 0));

    const po = await prisma.purchaseOrder.create({
      data: {
        poNumber: await nextPurchaseOrderNumber(),
        supplierId: supplier.id,
        branchId,
        firmId: supplier.firmId,
        status: "SENT",
        orderDate: input.orderDate,
        expectedDate: input.expectedDate,
        subtotal,
        taxAmount,
        total: round2(subtotal + taxAmount),
        notes: input.notes ?? null,
        createdById: user.id,
        items: {
          create: lines.map((line) => ({
            itemId: line.itemId,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            taxRate: line.taxRate,
            lineTotal: line.lineTotal,
          })),
        },
      },
      select: { id: true, poNumber: true, total: true },
    });

    await recordAudit({
      userId: user.id,
      branchId,
      action: "PURCHASE_ORDER_CREATED",
      entity: "PurchaseOrder",
      entityId: po.id,
      summary: `${po.poNumber} to ${supplier.name} for ${formatCurrency(po.total)}`,
    });

    revalidatePath("/purchases");
    return { id: po.id, poNumber: po.poNumber };
  });
}

/**
 * Receives goods against a purchase order: records the GRN, tops up branch
 * stock, and moves the PO to partially/fully received.
 */
export async function receiveGoodsAction(
  payload: unknown,
): Promise<ActionResult<{ grnNumber: string }>> {
  return runAction(async () => {
    const user = await authorize(PERMISSIONS.PURCHASE_MANAGE);
    const input = receiveGoodsSchema.parse(payload);

    const po = await prisma.purchaseOrder.findUnique({
      where: { id: input.poId },
      include: { items: true, supplier: { select: { name: true } } },
    });
    if (!po) throw new NotFoundError("Purchase order not found");
    assertBranchAccess(user, po.branchId);
    assertFirmAccess(user, po.firmId);
    if (["CANCELLED", "CLOSED"].includes(po.status)) {
      throw new BusinessRuleError("This purchase order is closed");
    }

    const itemById = new Map(po.items.map((item) => [item.id, item]));

    for (const line of input.lines) {
      const poItem = itemById.get(line.poItemId);
      if (!poItem) throw new BusinessRuleError("A received line does not belong to this order");
      const outstanding = round3(num(poItem.quantity) - num(poItem.receivedQuantity));
      if (line.quantity > outstanding) {
        throw new BusinessRuleError(
          `Only ${outstanding} outstanding on one of the lines — cannot receive ${line.quantity}`,
        );
      }
    }

    const grn = await prisma.$transaction(async (tx) => {
      const receipt = await tx.goodsReceipt.create({
        data: {
          grnNumber: await nextGoodsReceiptNumber(tx),
          poId: po.id,
          branchId: po.branchId,
          receivedById: user.id,
          notes: input.notes ?? null,
          items: {
            create: input.lines
              .filter((line) => line.quantity > 0)
              .map((line) => {
                const poItem = itemById.get(line.poItemId)!;
                return {
                  itemId: poItem.itemId,
                  quantity: line.quantity,
                  unitPrice: num(poItem.unitPrice),
                };
              }),
          },
        },
        select: { id: true, grnNumber: true },
      });

      for (const line of input.lines) {
        if (line.quantity <= 0) continue;
        const poItem = itemById.get(line.poItemId)!;

        await tx.purchaseOrderItem.update({
          where: { id: poItem.id },
          data: { receivedQuantity: { increment: line.quantity } },
        });

        await applyStockMovement(tx, {
          itemId: poItem.itemId,
          branchId: po.branchId,
          firmId: po.firmId,
          type: "STOCK_IN",
          quantity: line.quantity,
          unitCost: num(poItem.unitPrice),
          reference: `${po.poNumber} · ${receipt.grnNumber}`,
          userId: user.id,
        });
      }

      const refreshed = await tx.purchaseOrderItem.findMany({
        where: { poId: po.id },
        select: { quantity: true, receivedQuantity: true },
      });

      const fullyReceived = refreshed.every(
        (item) => num(item.receivedQuantity) >= num(item.quantity),
      );
      const anyReceived = refreshed.some((item) => num(item.receivedQuantity) > 0);

      await tx.purchaseOrder.update({
        where: { id: po.id },
        data: {
          status: fullyReceived
            ? "RECEIVED"
            : anyReceived
              ? "PARTIALLY_RECEIVED"
              : po.status,
        },
      });

      // A received PO becomes a payable.
      if (fullyReceived) {
        await tx.purchaseInvoice.upsert({
          where: {
            supplierId_invoiceNumber: {
              supplierId: po.supplierId,
              invoiceNumber: po.poNumber,
            },
          },
          create: {
            invoiceNumber: po.poNumber,
            supplierId: po.supplierId,
            poId: po.id,
            subtotal: num(po.subtotal),
            taxAmount: num(po.taxAmount),
            total: num(po.total),
            status: "UNPAID",
          },
          update: {},
        });
      }

      return receipt;
    });

    await recordAudit({
      userId: user.id,
      branchId: po.branchId,
      action: "GOODS_RECEIVED",
      entity: "GoodsReceipt",
      entityId: grn.id,
      summary: `${grn.grnNumber} against ${po.poNumber} from ${po.supplier.name}`,
    });

    revalidatePath("/purchases");
    revalidatePath(`/purchases/${po.id}`);
    revalidatePath("/inventory");
    return { grnNumber: grn.grnNumber };
  });
}

export async function recordSupplierPaymentAction(
  payload: unknown,
): Promise<ActionResult<{ paymentNumber: string }>> {
  return runAction(async () => {
    const user = await authorize(PERMISSIONS.PURCHASE_PAY);
    const input = supplierPaymentSchema.parse(payload);

    const supplier = await prisma.supplier.findUnique({
      where: { id: input.supplierId },
      select: { id: true, firmId: true, name: true },
    });
    if (!supplier) throw new NotFoundError("Supplier not found");
    assertFirmAccess(user, supplier.firmId);

    if (input.invoiceId) {
      const invoice = await prisma.purchaseInvoice.findUnique({
        where: { id: input.invoiceId },
        select: { total: true, amountPaid: true, supplierId: true },
      });
      if (!invoice) throw new NotFoundError("Purchase invoice not found");
      if (invoice.supplierId !== supplier.id) {
        throw new BusinessRuleError("That invoice belongs to another supplier");
      }
      const due = round2(num(invoice.total) - num(invoice.amountPaid));
      if (input.amount > due) {
        throw new BusinessRuleError(`Only ${formatCurrency(due)} is due on that invoice`);
      }
    }

    const payment = await prisma.$transaction(async (tx) => {
      const created = await tx.supplierPayment.create({
        data: {
          paymentNumber: await nextSupplierPaymentNumber(tx),
          supplierId: supplier.id,
          invoiceId: input.invoiceId ?? null,
          amount: input.amount,
          method: input.method,
          reference: input.reference ?? null,
          notes: input.notes ?? null,
          paidById: user.id,
        },
        select: { id: true, paymentNumber: true },
      });

      if (input.invoiceId) {
        const invoice = await tx.purchaseInvoice.update({
          where: { id: input.invoiceId },
          data: { amountPaid: { increment: input.amount } },
          select: { total: true, amountPaid: true },
        });

        await tx.purchaseInvoice.update({
          where: { id: input.invoiceId },
          data: {
            status:
              num(invoice.amountPaid) >= num(invoice.total)
                ? "PAID"
                : "PARTIALLY_PAID",
          },
        });
      }

      return created;
    });

    await recordAudit({
      userId: user.id,
      branchId: user.branchId,
      action: "SUPPLIER_PAYMENT_RECORDED",
      entity: "SupplierPayment",
      entityId: payment.id,
      summary: `${formatCurrency(input.amount)} paid to ${supplier.name}`,
    });

    revalidatePath("/purchases");
    return { paymentNumber: payment.paymentNumber };
  });
}

export async function createPurchaseReturnAction(
  payload: unknown,
): Promise<ActionResult<{ returnNumber: string }>> {
  return runAction(async () => {
    const user = await authorize(PERMISSIONS.PURCHASE_MANAGE);
    const input = purchaseReturnSchema.parse(payload);
    const branchId = await requireWriteBranch(user, input.branchId);

    const returnSupplier = await prisma.supplier.findUnique({
      where: { id: input.supplierId },
      select: { firmId: true },
    });
    if (!returnSupplier) throw new NotFoundError("Supplier not found");
    assertFirmAccess(user, returnSupplier.firmId);

    if (input.poId) {
      const returnPo = await prisma.purchaseOrder.findUnique({
        where: { id: input.poId },
        select: { firmId: true },
      });
      if (!returnPo) throw new NotFoundError("Purchase order not found");
      assertFirmAccess(user, returnPo.firmId);
    }

    const total = round2(
      input.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0),
    );

    const created = await prisma.$transaction(async (tx) => {
      const purchaseReturn = await tx.purchaseReturn.create({
        data: {
          returnNumber: await nextPurchaseReturnNumber(tx),
          supplierId: input.supplierId,
          poId: input.poId ?? null,
          branchId,
          reason: input.reason,
          total,
          items: {
            create: input.items.map((item) => ({
              itemId: item.itemId,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
            })),
          },
        },
        select: { id: true, returnNumber: true },
      });

      // Returned goods leave our stock.
      for (const item of input.items) {
        await applyStockMovement(tx, {
          itemId: item.itemId,
          branchId,
          firmId: returnSupplier.firmId,
          type: "STOCK_OUT",
          quantity: item.quantity,
          unitCost: item.unitPrice,
          reference: purchaseReturn.returnNumber,
          notes: input.reason,
          userId: user.id,
        });
      }

      return purchaseReturn;
    });

    await recordAudit({
      userId: user.id,
      branchId,
      action: "PURCHASE_RETURN_CREATED",
      entity: "PurchaseReturn",
      entityId: created.id,
      summary: `${created.returnNumber} — ${formatCurrency(total)} returned: ${input.reason}`,
    });

    revalidatePath("/purchases");
    revalidatePath("/inventory");
    return { returnNumber: created.returnNumber };
  });
}

export async function cancelPurchaseOrderAction(
  poId: string,
  reason: string,
): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize(PERMISSIONS.PURCHASE_MANAGE);

    const po = await prisma.purchaseOrder.findUnique({
      where: { id: poId },
      select: { id: true, branchId: true, firmId: true, poNumber: true, status: true },
    });
    if (!po) throw new NotFoundError("Purchase order not found");
    assertBranchAccess(user, po.branchId);
    assertFirmAccess(user, po.firmId);
    if (["RECEIVED", "CANCELLED"].includes(po.status)) {
      throw new BusinessRuleError("This purchase order can no longer be cancelled");
    }

    await prisma.purchaseOrder.update({
      where: { id: poId },
      data: { status: "CANCELLED", notes: reason },
    });

    await recordAudit({
      userId: user.id,
      branchId: po.branchId,
      action: "PURCHASE_ORDER_CANCELLED",
      entity: "PurchaseOrder",
      entityId: poId,
      summary: `${po.poNumber} cancelled: ${reason}`,
    });

    revalidatePath("/purchases");
    return null;
  });
}


/**
 * Retiring a supplier. One with purchase history is deactivated so it leaves
 * the pickers while every order and invoice against it stays readable; one that
 * has never been ordered from is deleted outright.
 */
export async function archiveSupplierAction(
  payload: unknown,
): Promise<ActionResult<{ deleted: boolean }>> {
  return runAction(async () => {
    const user = await authorize(PERMISSIONS.PURCHASE_MANAGE);
    const { id } = z.object({ id: cuidSchema }).parse(payload);

    const supplier = await prisma.supplier.findUnique({
      where: { id },
      select: {
        id: true,
        firmId: true,
        name: true,
        isActive: true,
        _count: { select: { purchaseOrders: true, payments: true } },
      },
    });
    if (!supplier) throw new NotFoundError("Supplier not found");
    assertFirmAccess(user, supplier.firmId);

    if (supplier._count.purchaseOrders + supplier._count.payments > 0) {
      if (!supplier.isActive) {
        throw new BusinessRuleError(`${supplier.name} is already retired`);
      }
      await prisma.supplier.update({ where: { id }, data: { isActive: false } });
      await recordAudit({
        userId: user.id,
        action: "SUPPLIER_RETIRED",
        entity: "Supplier",
        entityId: id,
        summary: `${supplier.name} retired — ${supplier._count.purchaseOrders} purchase orders kept`,
      });
      revalidatePath("/purchases");
      return { deleted: false };
    }

    await prisma.supplier.delete({ where: { id } });
    await recordAudit({
      userId: user.id,
      action: "SUPPLIER_DELETED",
      entity: "Supplier",
      entityId: id,
      summary: `${supplier.name} removed`,
    });
    revalidatePath("/purchases");
    return { deleted: true };
  });
}
