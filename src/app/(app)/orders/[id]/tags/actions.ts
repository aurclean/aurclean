"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { PERMISSIONS } from "@/lib/rbac";
import { assertBranchAccess, assertFirmAccess, authorize } from "@/lib/session";
import { NotFoundError, runAction, type ActionResult } from "@/lib/action-result";
import { cuidSchema } from "@/lib/validations/common";
import { z } from "zod";

const tagPrintSchema = z.object({
  orderId: cuidSchema,
  scope: z.enum(["ORDER", "GARMENTS", "BOTH"]),
  widthMm: z.coerce.number().int().min(40).max(120),
  copies: z.coerce.number().int().min(1).max(20).default(1),
});

export interface TagPrintReceipt {
  tagPrintCount: number;
  tagLastPrintedAt: string;
  isReprint: boolean;
}

/**
 * Records that tags left the printer. The browser does the actual printing, so
 * this is what makes a reprint distinguishable from a first print — useful when
 * a customer turns up with a tag that was replaced.
 */
export async function recordTagPrintAction(
  payload: unknown,
): Promise<ActionResult<TagPrintReceipt>> {
  return runAction(async () => {
    const user = await authorize(PERMISSIONS.GARMENT_VIEW);
    const input = tagPrintSchema.parse(payload);

    const order = await prisma.order.findUnique({
      where: { id: input.orderId },
      select: { id: true, orderNumber: true, branchId: true, firmId: true, tagPrintCount: true },
    });
    if (!order) throw new NotFoundError("Order not found");
    assertBranchAccess(user, order.branchId);
    assertFirmAccess(user, order.firmId);

    const isReprint = order.tagPrintCount > 0;
    const printedAt = new Date();

    const updated = await prisma.order.update({
      where: { id: order.id },
      data: {
        tagPrintCount: { increment: input.copies },
        tagLastPrintedAt: printedAt,
      },
      select: { tagPrintCount: true, tagLastPrintedAt: true },
    });

    await recordAudit({
      userId: user.id,
      branchId: order.branchId,
      action: isReprint ? "TAG_REPRINT" : "TAG_PRINT",
      entity: "Order",
      entityId: order.id,
      summary: `${isReprint ? "Reprinted" : "Printed"} ${input.scope.toLowerCase()} tags for ${order.orderNumber} at ${input.widthMm}mm`,
    });

    revalidatePath(`/orders/${order.id}`);
    revalidatePath(`/orders/${order.id}/tags`);

    return {
      tagPrintCount: updated.tagPrintCount,
      tagLastPrintedAt: (updated.tagLastPrintedAt ?? printedAt).toISOString(),
      isReprint,
    };
  });
}
