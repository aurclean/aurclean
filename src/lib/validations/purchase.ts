import { z } from "zod";

import {
  cuidSchema,
  dateSchema,
  moneySchema,
  optionalDate,
  optionalEmail,
  optionalPhone,
  optionalText,
  percentSchema,
  weightSchema,
} from "@/lib/validations/common";

export const supplierSchema = z.object({
  id: z.string().optional(),
  code: z
    .string()
    .trim()
    .min(2, "Code is required")
    .max(20)
    .regex(/^[A-Za-z0-9-]+$/, "Use letters, digits or hyphens only")
    .transform((value) => value.toUpperCase()),
  name: z.string().trim().min(2, "Name is required").max(120),
  contactPerson: optionalText(120),
  phone: optionalPhone,
  email: optionalEmail,
  addressLine: optionalText(300),
  gstNumber: optionalText(20),
  paymentTerms: optionalText(120),
  creditDays: z.coerce.number().int().min(0).max(365).default(0),
  isActive: z.boolean().default(true),
});

export const purchaseOrderItemSchema = z.object({
  itemId: cuidSchema,
  quantity: weightSchema.refine((value) => value > 0, "Quantity must be greater than zero"),
  unitPrice: moneySchema,
  taxRate: percentSchema.default(0),
});

export const purchaseOrderSchema = z.object({
  supplierId: cuidSchema,
  branchId: cuidSchema,
  orderDate: dateSchema,
  expectedDate: optionalDate,
  notes: optionalText(500),
  items: z.array(purchaseOrderItemSchema).min(1, "Add at least one item"),
});

export const receiveGoodsSchema = z.object({
  poId: cuidSchema,
  notes: optionalText(300),
  lines: z
    .array(
      z.object({
        poItemId: cuidSchema,
        quantity: weightSchema,
      }),
    )
    .min(1, "Record at least one received line"),
});

export const supplierPaymentSchema = z.object({
  supplierId: cuidSchema,
  invoiceId: z
    .string()
    .trim()
    .transform((value) => (value === "" || value === "none" ? null : value))
    .nullable()
    .optional(),
  amount: moneySchema.refine((value) => value > 0, "Enter an amount greater than zero"),
  method: z
    .enum(["CASH", "UPI", "CARD", "ONLINE", "BANK_TRANSFER"])
    .default("BANK_TRANSFER"),
  reference: optionalText(120),
  notes: optionalText(300),
});

export const purchaseReturnSchema = z.object({
  supplierId: cuidSchema,
  branchId: cuidSchema,
  poId: z
    .string()
    .trim()
    .transform((value) => (value === "" || value === "none" ? null : value))
    .nullable()
    .optional(),
  reason: z.string().trim().min(3, "Give a reason").max(500),
  items: z
    .array(
      z.object({
        itemId: cuidSchema,
        quantity: weightSchema.refine((value) => value > 0, "Quantity must be greater than zero"),
        unitPrice: moneySchema.default(0),
      }),
    )
    .min(1, "Add at least one item"),
});
