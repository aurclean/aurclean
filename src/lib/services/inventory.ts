import "server-only";
import { prisma } from "@/lib/prisma";
import { BusinessRuleError, NotFoundError } from "@/lib/action-result";
import { num, round3 } from "@/lib/money";
import type { Prisma } from "@/generated/prisma/client";
import type { InventoryTxnType } from "@/generated/prisma/enums";

type Tx = Prisma.TransactionClient;

const DECREASING: InventoryTxnType[] = [
  "STOCK_OUT",
  "TRANSFER_OUT",
  "CONSUMPTION",
  "WASTAGE",
];

/**
 * Applies a stock movement and records the ledger entry with the resulting
 * balance, so consumption history can be read back without re-summing.
 *
 * `ADJUSTMENT` sets the balance to the given quantity; every other type moves
 * it up or down.
 */
export async function applyStockMovement(
  tx: Tx,
  params: {
    itemId: string;
    branchId: string;
    firmId: string;
    type: InventoryTxnType;
    quantity: number;
    unitCost?: number | null;
    reference?: string | null;
    notes?: string | null;
    userId: string;
    counterpartBranchId?: string | null;
  },
): Promise<number> {
  const item = await tx.inventoryItem.findUnique({
    where: { id: params.itemId },
    select: { id: true, name: true, unit: true, firmId: true },
  });
  if (!item) throw new NotFoundError("Inventory item not found");
  if (item.firmId !== params.firmId) throw new NotFoundError("Inventory item not found");

  const stock = await tx.inventoryStock.upsert({
    where: { itemId_branchId: { itemId: params.itemId, branchId: params.branchId } },
    create: { itemId: params.itemId, branchId: params.branchId, quantity: 0 },
    update: {},
  });

  const current = num(stock.quantity);
  const delta = DECREASING.includes(params.type) ? -params.quantity : params.quantity;

  const balanceAfter =
    params.type === "ADJUSTMENT" ? round3(params.quantity) : round3(current + delta);

  if (balanceAfter < 0) {
    throw new BusinessRuleError(
      `Only ${current} ${item.unit} of ${item.name} is in stock at this branch`,
    );
  }

  await tx.inventoryStock.update({
    where: { id: stock.id },
    data: { quantity: balanceAfter },
  });

  await tx.inventoryTransaction.create({
    data: {
      itemId: params.itemId,
      branchId: params.branchId,
      type: params.type,
      quantity: params.type === "ADJUSTMENT" ? round3(balanceAfter - current) : params.quantity,
      balanceAfter,
      unitCost: params.unitCost ?? null,
      counterpartBranchId: params.counterpartBranchId ?? null,
      reference: params.reference ?? null,
      notes: params.notes ?? null,
      userId: params.userId,
    },
  });

  return balanceAfter;
}

/** Items at or below their minimum level, for the dashboard and alerts. */
export async function lowStockItems(firmId: string, branchId?: string) {
  const stocks = await prisma.inventoryStock.findMany({
    where: { ...(branchId ? { branchId } : {}), item: { firmId, isActive: true } },
    include: {
      item: { select: { id: true, sku: true, name: true, unit: true, minStockLevel: true, category: true } },
      branch: { select: { id: true, name: true } },
    },
  });

  return stocks
    .filter((stock) => num(stock.quantity) <= num(stock.item.minStockLevel))
    .map((stock) => ({
      itemId: stock.item.id,
      sku: stock.item.sku,
      name: stock.item.name,
      unit: stock.item.unit,
      category: stock.item.category,
      branchId: stock.branch.id,
      branchName: stock.branch.name,
      quantity: num(stock.quantity),
      minStockLevel: num(stock.item.minStockLevel),
    }))
    .sort((a, b) => a.quantity - b.quantity);
}
