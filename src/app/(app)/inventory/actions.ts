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
import { applyStockMovement } from "@/lib/services/inventory";
import {
  inventoryItemSchema,
  stockMovementSchema,
  stockTransferSchema,
} from "@/lib/validations/inventory";

export async function saveInventoryItemAction(
  payload: unknown,
): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const user = await authorize(PERMISSIONS.INVENTORY_MANAGE);
    const input = inventoryItemSchema.parse(payload);

    if (input.id) {
      const existing = await prisma.inventoryItem.findUnique({ where: { id: input.id }, select: { firmId: true } });
      if (!existing) throw new NotFoundError("Inventory item not found");
      assertFirmAccess(user, existing.firmId);
    }

    const item = input.id
      ? await prisma.inventoryItem.update({
          where: { id: input.id },
          data: {
            sku: input.sku,
            name: input.name,
            category: input.category,
            unit: input.unit,
            description: input.description ?? null,
            minStockLevel: input.minStockLevel,
            costPrice: input.costPrice,
            isActive: input.isActive,
          },
        })
      : await prisma.inventoryItem.create({
          data: {
            sku: input.sku,
            name: input.name,
            firmId: requireFirmId(user),
            category: input.category,
            unit: input.unit,
            description: input.description ?? null,
            minStockLevel: input.minStockLevel,
            costPrice: input.costPrice,
            isActive: input.isActive,
          },
        });

    await recordAudit({
      userId: user.id,
      branchId: user.branchId,
      action: input.id ? "INVENTORY_ITEM_UPDATED" : "INVENTORY_ITEM_CREATED",
      entity: "InventoryItem",
      entityId: item.id,
      summary: `${item.sku} — ${item.name}`,
    });

    revalidatePath("/inventory");
    return { id: item.id };
  });
}

export async function recordStockMovementAction(
  payload: unknown,
): Promise<ActionResult<{ balance: number }>> {
  return runAction(async () => {
    const input = stockMovementSchema.parse(payload);
    const user = await authorize(
      input.type === "ADJUSTMENT"
        ? PERMISSIONS.INVENTORY_ADJUST
        : PERMISSIONS.INVENTORY_MANAGE,
    );
    const branchId = await requireWriteBranch(user, input.branchId);

    const balance = await prisma.$transaction((tx) =>
      applyStockMovement(tx, {
        itemId: input.itemId,
        branchId,
        firmId: requireFirmId(user),
        type: input.type,
        quantity: input.quantity,
        unitCost: input.unitCost ?? null,
        reference: input.reference ?? null,
        notes: input.notes ?? null,
        userId: user.id,
      }),
    );

    await recordAudit({
      userId: user.id,
      branchId,
      action: `STOCK_${input.type}`,
      entity: "InventoryItem",
      entityId: input.itemId,
      summary: `${input.type} of ${input.quantity} — balance now ${balance}`,
    });

    revalidatePath("/inventory");
    revalidatePath("/dashboard");
    return { balance };
  });
}

/** Moves stock between branches as a matched out/in pair in one transaction. */
export async function transferStockAction(
  payload: unknown,
): Promise<ActionResult<{ fromBalance: number; toBalance: number }>> {
  return runAction(async () => {
    const user = await authorize(PERMISSIONS.INVENTORY_TRANSFER);
    const input = stockTransferSchema.parse(payload);

    assertBranchAccess(user, input.fromBranchId);
    const firmId = requireFirmId(user);

    const [fromBranch, toBranch] = await Promise.all([
      prisma.branch.findUnique({
        where: { id: input.fromBranchId },
        select: { name: true, firmId: true },
      }),
      prisma.branch.findUnique({
        where: { id: input.toBranchId },
        select: { name: true, firmId: true },
      }),
    ]);
    if (!fromBranch || !toBranch) throw new NotFoundError("Branch not found");
    assertFirmAccess(user, fromBranch.firmId);
    assertFirmAccess(user, toBranch.firmId);

    const result = await prisma.$transaction(async (tx) => {
      const fromBalance = await applyStockMovement(tx, {
        itemId: input.itemId,
        branchId: input.fromBranchId,
        firmId,
        type: "TRANSFER_OUT",
        quantity: input.quantity,
        reference: `To ${toBranch.name}`,
        notes: input.notes ?? null,
        userId: user.id,
        counterpartBranchId: input.toBranchId,
      });

      const toBalance = await applyStockMovement(tx, {
        itemId: input.itemId,
        branchId: input.toBranchId,
        firmId,
        type: "TRANSFER_IN",
        quantity: input.quantity,
        reference: `From ${fromBranch.name}`,
        notes: input.notes ?? null,
        userId: user.id,
        counterpartBranchId: input.fromBranchId,
      });

      return { fromBalance, toBalance };
    });

    await recordAudit({
      userId: user.id,
      branchId: input.fromBranchId,
      action: "STOCK_TRANSFERRED",
      entity: "InventoryItem",
      entityId: input.itemId,
      summary: `${input.quantity} moved from ${fromBranch.name} to ${toBranch.name}`,
    });

    revalidatePath("/inventory");
    return result;
  });
}

export async function toggleInventoryItemAction(
  itemId: string,
  isActive: boolean,
): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize(PERMISSIONS.INVENTORY_MANAGE);

    const item = await prisma.inventoryItem.findUnique({
      where: { id: itemId },
      select: { id: true, sku: true, name: true, firmId: true },
    });
    if (!item) throw new NotFoundError("Inventory item not found");
    assertFirmAccess(user, item.firmId);

    if (!isActive) {
      const remaining = await prisma.inventoryStock.aggregate({
        where: { itemId },
        _sum: { quantity: true },
      });
      if (Number(remaining._sum.quantity ?? 0) > 0) {
        throw new BusinessRuleError(
          `${item.name} still has stock on hand — write it off before retiring it`,
        );
      }
    }

    await prisma.inventoryItem.update({ where: { id: itemId }, data: { isActive } });

    await recordAudit({
      userId: user.id,
      branchId: user.branchId,
      action: isActive ? "INVENTORY_ITEM_ACTIVATED" : "INVENTORY_ITEM_RETIRED",
      entity: "InventoryItem",
      entityId: itemId,
      summary: `${item.sku} ${isActive ? "activated" : "retired"}`,
    });

    revalidatePath("/inventory");
    return null;
  });
}
