import "server-only";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * Atomically increments a named counter and returns the new value.
 * Uses a single INSERT .. ON CONFLICT DO UPDATE so that concurrent callers
 * can never receive the same number.
 */
export async function nextSequence(key: string, db: Db = prisma): Promise<number> {
  const rows = await db.$queryRaw<Array<{ value: number }>>`
    INSERT INTO "sequences" ("key", "value", "updatedAt")
    VALUES (${key}, 1, NOW())
    ON CONFLICT ("key")
    DO UPDATE SET "value" = "sequences"."value" + 1, "updatedAt" = NOW()
    RETURNING "value"
  `;
  return rows[0]?.value ?? 1;
}

export const SEQUENCE_KEYS = {
  ORDER: "order",
  GARMENT: "garment",
  INVOICE: "invoice",
  PAYMENT: "payment",
  REFUND: "refund",
  PICKUP: "pickup",
  DELIVERY: "delivery",
  COMPLAINT: "complaint",
  PURCHASE_ORDER: "purchase_order",
  GOODS_RECEIPT: "goods_receipt",
  SUPPLIER_PAYMENT: "supplier_payment",
  PURCHASE_RETURN: "purchase_return",
  EXPENSE: "expense",
  BATCH: "batch",
  STATEMENT: "statement",
  CONTRACT: "contract",
  B2B_ACCOUNT: "b2b_account",
  SUPPLIER: "supplier",
  EMPLOYEE: "employee",
  CUSTOMER: "customer",
  DELIVERY_CHALLAN: "delivery_challan",
} as const;

function pad(value: number, width: number): string {
  return value.toString().padStart(width, "0");
}

/** ORD10245 — matches the operational numbering used on the shop floor. */
export async function nextOrderNumber(db: Db = prisma): Promise<string> {
  const value = await nextSequence(SEQUENCE_KEYS.ORDER, db);
  return `ORD${10000 + value}`;
}

/**
 * TR-1042 — printed on every garment tag. Each tracking category counts on its
 * own sequence, so the prefix tells an operator what they are holding before
 * they have read the number.
 */
export const garmentSequenceKey = (prefix: string) =>
  `${SEQUENCE_KEYS.GARMENT}:${prefix.toUpperCase()}`;

export function formatGarmentCode(prefix: string, value: number): string {
  return `${prefix.toUpperCase()}-${1000 + value}`;
}

export async function nextGarmentCode(
  prefix: string,
  db: Db = prisma,
): Promise<string> {
  const value = await nextSequence(garmentSequenceKey(prefix), db);
  return formatGarmentCode(prefix, value);
}

/**
 * Allocates a contiguous block of codes for one category in a single round
 * trip, which is what makes booking a 40-piece order one fast transaction.
 */
export async function nextGarmentCodeBlock(
  prefix: string,
  count: number,
  db: Db = prisma,
): Promise<string[]> {
  if (count <= 0) return [];
  const key = garmentSequenceKey(prefix);
  const rows = await db.$queryRaw<Array<{ value: number }>>`
    INSERT INTO "sequences" ("key", "value", "updatedAt")
    VALUES (${key}, ${count}, NOW())
    ON CONFLICT ("key")
    DO UPDATE SET "value" = "sequences"."value" + ${count}, "updatedAt" = NOW()
    RETURNING "value"
  `;
  const end = rows[0]?.value ?? count;
  const start = end - count + 1;
  return Array.from({ length: count }, (_, i) => formatGarmentCode(prefix, start + i));
}

export async function nextDocumentNumber(
  key: string,
  prefix: string,
  width = 6,
  db: Db = prisma,
): Promise<string> {
  const value = await nextSequence(key, db);
  return `${prefix}${pad(value, width)}`;
}

/**
 * The numbering prefix a firm configured in Settings > Documents. Only a
 * short alphanumeric prefix is honoured so a stored value can never change
 * the shape of a number (or inject separators); anything else falls back to
 * the default. The counter stays global, so every number remains unique
 * across firms and branches.
 */
export async function firmDocumentPrefix(
  firmId: string | undefined,
  key: "invoice_prefix" | "challan_prefix",
  fallback: string,
  db: Db = prisma,
): Promise<string> {
  if (!firmId) return fallback;
  const row = await db.setting.findUnique({ where: { firmId_key: { firmId, key } }, select: { value: true } });
  const value = row?.value?.trim().toUpperCase();
  return value && /^[A-Z0-9]{1,8}$/.test(value) ? value : fallback;
}

export const nextInvoiceNumber = async (db: Db = prisma, firmId?: string) =>
  nextDocumentNumber(
    SEQUENCE_KEYS.INVOICE,
    await firmDocumentPrefix(firmId, "invoice_prefix", "INV", db),
    6,
    db,
  );
export const nextPaymentNumber = (db?: Db) =>
  nextDocumentNumber(SEQUENCE_KEYS.PAYMENT, "PAY", 6, db);
export const nextRefundNumber = (db?: Db) =>
  nextDocumentNumber(SEQUENCE_KEYS.REFUND, "REF", 6, db);
export const nextPickupNumber = (db?: Db) =>
  nextDocumentNumber(SEQUENCE_KEYS.PICKUP, "PCK", 6, db);
export const nextDeliveryNumber = (db?: Db) =>
  nextDocumentNumber(SEQUENCE_KEYS.DELIVERY, "DLV", 6, db);
export const nextComplaintNumber = (db?: Db) =>
  nextDocumentNumber(SEQUENCE_KEYS.COMPLAINT, "CMP", 5, db);
export const nextPurchaseOrderNumber = (db?: Db) =>
  nextDocumentNumber(SEQUENCE_KEYS.PURCHASE_ORDER, "PO", 5, db);
export const nextGoodsReceiptNumber = (db?: Db) =>
  nextDocumentNumber(SEQUENCE_KEYS.GOODS_RECEIPT, "GRN", 5, db);
export const nextSupplierPaymentNumber = (db?: Db) =>
  nextDocumentNumber(SEQUENCE_KEYS.SUPPLIER_PAYMENT, "SPY", 5, db);
export const nextPurchaseReturnNumber = (db?: Db) =>
  nextDocumentNumber(SEQUENCE_KEYS.PURCHASE_RETURN, "PRT", 5, db);
export const nextExpenseNumber = (db?: Db) =>
  nextDocumentNumber(SEQUENCE_KEYS.EXPENSE, "EXP", 5, db);
export const nextBatchCode = (db?: Db) =>
  nextDocumentNumber(SEQUENCE_KEYS.BATCH, "BAT", 5, db);
export const nextStatementNumber = (db?: Db) =>
  nextDocumentNumber(SEQUENCE_KEYS.STATEMENT, "STM", 5, db);
export const nextContractNumber = (db?: Db) =>
  nextDocumentNumber(SEQUENCE_KEYS.CONTRACT, "CNT", 5, db);
export const nextCustomerCode = (db?: Db) =>
  nextDocumentNumber(SEQUENCE_KEYS.CUSTOMER, "CUS", 5, db);
export const nextEmployeeCode = (db?: Db) =>
  nextDocumentNumber(SEQUENCE_KEYS.EMPLOYEE, "EMP", 4, db);
export const nextLedgerReference = (db?: Db) =>
  nextDocumentNumber("financial_ledger", "LED", 6, db);
export const nextTransferReference = (db?: Db) =>
  nextDocumentNumber("transfer", "TRF", 6, db);
export const nextReconciliationReference = (db?: Db) =>
  nextDocumentNumber("reconciliation", "REC", 6, db);

export const nextChallanNumber = async (db: Db = prisma, firmId?: string): Promise<string> => {
  const year = new Date().getFullYear();
  const prefix = await firmDocumentPrefix(firmId, "challan_prefix", "DC", db);
  const value = await nextSequence(SEQUENCE_KEYS.DELIVERY_CHALLAN, db);
  return `${prefix}-${year}-${pad(value, 6)}`;
};


