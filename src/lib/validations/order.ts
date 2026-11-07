import { z } from "zod";

import {
  cuidSchema,
  dateSchema,
  moneySchema,
  optionalCuid,
  optionalEmail,
  optionalText,
  percentSchema,
  phoneSchema,
  quantitySchema,
  weightSchema,
} from "@/lib/validations/common";

export const orderItemSchema = z.object({
  serviceId: cuidSchema,
  garmentTypeId: cuidSchema,
  quantity: quantitySchema,
  weightKg: weightSchema.default(0),
  /** Set only when a user with override permission edits the computed price. */
  unitPriceOverride: z.coerce.number().min(0).optional().nullable(),
  notes: optionalText(500),
});

export const createOrderSchema = z
  .object({
    branchId: cuidSchema,
    type: z.enum(["WALK_IN", "PICKUP", "DELIVERY"]).default("WALK_IN"),
    priority: z.enum(["NORMAL", "EXPRESS", "URGENT"]).default("NORMAL"),

    customerName: z.string().trim().min(2, "Customer name is required").max(120),
    customerPhone: phoneSchema,
    customerEmail: optionalEmail,
    addressLine: optionalText(300),
    city: optionalText(80),
    pincode: optionalText(12),
    landmark: optionalText(120),

    /** Set when the counter picked an existing customer from the directory. */
    customerId: optionalCuid,

    b2bAccountId: optionalCuid,

    expectedDeliveryAt: dateSchema,

    items: z.array(orderItemSchema).min(1, "Add at least one line item"),

    discountAmount: moneySchema.default(0),
    discountReason: optionalText(200),
    gstRate: percentSchema.default(18),

    advanceAmount: moneySchema.default(0),
    advanceMethod: z
      .enum(["CASH", "UPI", "CARD", "ONLINE", "BANK_TRANSFER", "CREDIT", "OTHER"])
      .default("CASH"),

    specialInstructions: optionalText(1000),
    stainNotes: optionalText(1000),
    damageNotes: optionalText(1000),

    pickupScheduledAt: z
      .union([z.coerce.date(), z.literal(""), z.null(), z.undefined()])
      .transform((value) =>
        value === "" || value === null || value === undefined ? null : value,
      ),
  })
  .refine(
    (data) => data.type !== "PICKUP" || Boolean(data.addressLine),
    { message: "A pickup address is required", path: ["addressLine"] },
  )
  .refine(
    (data) => data.type !== "DELIVERY" || Boolean(data.addressLine),
    { message: "A delivery address is required", path: ["addressLine"] },
  );

export type CreateOrderInput = z.infer<typeof createOrderSchema>;

export const updateOrderSchema = z.object({
  orderId: cuidSchema,
  customerName: z.string().trim().min(2).max(120),
  customerPhone: phoneSchema,
  customerEmail: optionalEmail,
  addressLine: optionalText(300),
  city: optionalText(80),
  pincode: optionalText(12),
  landmark: optionalText(120),
  expectedDeliveryAt: dateSchema,
  priority: z.enum(["NORMAL", "EXPRESS", "URGENT"]),
  specialInstructions: optionalText(1000),
  stainNotes: optionalText(1000),
  damageNotes: optionalText(1000),
});

export const orderStatusSchema = z.object({
  orderId: cuidSchema,
  status: z.enum([
    "RECEIVED",
    "SORTING",
    "WASHING",
    "DRYING",
    "IRONING",
    "QUALITY_CHECK",
    "PACKING",
    "READY",
    "OUT_FOR_DELIVERY",
    "PARTIALLY_DELIVERED",
    "DELIVERED",
    "ON_HOLD",
  ]),
  note: optionalText(500),
});

export const cancelOrderSchema = z.object({
  orderId: cuidSchema,
  reason: z.string().trim().min(3, "Give a reason for the cancellation").max(500),
  refundAmount: moneySchema.default(0),
});

export const applyDiscountSchema = z.object({
  orderId: cuidSchema,
  discountAmount: moneySchema,
  discountReason: optionalText(200),
});

export const orderFilterSchema = z.object({
  q: z.string().trim().optional(),
  status: z.string().optional(),
  branch: z.string().optional(),
  service: z.string().optional(),
  payment: z.string().optional(),
  type: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  delayed: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
});
