import { z } from "zod";

import {
  cuidSchema,
  moneySchema,
  optionalText,
  weightSchema,
} from "@/lib/validations/common";

export const inventoryCategorySchema = z.enum([
  "DETERGENT",
  "BLEACH",
  "FABRIC_SOFTENER",
  "STAIN_REMOVER",
  "CHEMICAL",
  "PACKAGING",
  "HANGER",
  "COVER",
  "TAG",
  "LABEL",
  "OTHER",
]);

export const inventoryItemSchema = z.object({
  id: z.string().optional(),
  sku: z
    .string()
    .trim()
    .min(2, "SKU is required")
    .max(32)
    .regex(/^[A-Za-z0-9-]+$/, "Use letters, digits or hyphens only")
    .transform((value) => value.toUpperCase()),
  name: z.string().trim().min(2, "Name is required").max(120),
  category: inventoryCategorySchema.default("OTHER"),
  unit: z.string().trim().min(1).max(16).default("pcs"),
  description: optionalText(300),
  minStockLevel: weightSchema.default(0),
  costPrice: moneySchema.default(0),
  isActive: z.boolean().default(true),
});

export const stockMovementSchema = z.object({
  itemId: cuidSchema,
  branchId: cuidSchema,
  type: z.enum(["STOCK_IN", "STOCK_OUT", "ADJUSTMENT", "CONSUMPTION", "WASTAGE", "RETURN"]),
  quantity: weightSchema.refine((value) => value > 0, "Enter a quantity greater than zero"),
  unitCost: moneySchema.optional(),
  reference: optionalText(120),
  notes: optionalText(300),
});

export const stockTransferSchema = z
  .object({
    itemId: cuidSchema,
    fromBranchId: cuidSchema,
    toBranchId: cuidSchema,
    quantity: weightSchema.refine((value) => value > 0, "Enter a quantity greater than zero"),
    notes: optionalText(300),
  })
  .refine((data) => data.fromBranchId !== data.toBranchId, {
    message: "Pick two different branches",
    path: ["toBranchId"],
  });
