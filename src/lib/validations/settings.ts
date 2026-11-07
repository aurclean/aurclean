import { z } from "zod";

import {
  cuidSchema,
  dateSchema,
  moneySchema,
  optionalCuid,
  optionalEmail,
  optionalPhone,
  optionalText,
  percentSchema,
} from "@/lib/validations/common";

export const branchSchema = z.object({
  id: z.string().optional(),
  code: z
    .string()
    .trim()
    .min(2, "Code is required")
    .max(12)
    .regex(/^[A-Za-z0-9-]+$/, "Use letters, digits or hyphens only")
    .transform((value) => value.toUpperCase()),
  name: z.string().trim().min(2, "Name is required").max(120),
  type: z.enum(["HEAD_OFFICE", "BRANCH", "CENTRAL_PROCESSING_UNIT"]).default("BRANCH"),
  parentId: optionalCuid,
  addressLine: optionalText(300),
  city: optionalText(80),
  state: optionalText(80),
  pincode: optionalText(12),
  phone: optionalPhone,
  email: optionalEmail,
  gstNumber: optionalText(20),
  openingTime: optionalText(5),
  closingTime: optionalText(5),
  isActive: z.boolean().default(true),
});

export const serviceSchema = z.object({
  id: z.string().optional(),
  code: z
    .string()
    .trim()
    .min(2, "Code is required")
    .max(20)
    .regex(/^[A-Za-z0-9-]+$/, "Use letters, digits or hyphens only")
    .transform((value) => value.toUpperCase()),
  name: z.string().trim().min(2, "Name is required").max(80),
  description: optionalText(300),
  pricingMode: z.enum(["PER_PIECE", "PER_KG", "FLAT"]).default("PER_PIECE"),
  basePrice: moneySchema,
  turnaroundHours: z.coerce.number().int().min(1).max(720).default(48),
  stages: z
    .array(
      z.enum([
        "SORTING",
        "WASHING",
        "DRYING",
        "IRONING",
        "QUALITY_CHECK",
        "PACKING",
      ]),
    )
    .min(1, "Pick at least one processing stage"),
  isActive: z.boolean().default(true),
});

export const garmentTypeSchema = z.object({
  id: z.string().optional(),
  code: z
    .string()
    .trim()
    .min(2, "Code is required")
    .max(20)
    .regex(/^[A-Za-z0-9-]+$/, "Use letters, digits or hyphens only")
    .transform((value) => value.toUpperCase()),
  name: z.string().trim().min(2, "Name is required").max(80),
  category: z.string().trim().min(1).max(40).default("GENERAL"),
  isActive: z.boolean().default(true),
});

export const serviceRateSchema = z.object({
  serviceId: cuidSchema,
  garmentTypeId: cuidSchema,
  price: moneySchema,
});

export const notificationTemplateSchema = z.object({
  id: z.string().optional(),
  code: z
    .string()
    .trim()
    .min(2, "Code is required")
    .max(60)
    .regex(/^[a-z0-9_]+$/, "Use lowercase letters, digits and underscores"),
  name: z.string().trim().min(2, "Name is required").max(80),
  channel: z.enum(["IN_APP", "EMAIL"]),
  event: z.enum([
    "ORDER_RECEIVED",
    "PROCESSING_STARTED",
    "ORDER_READY",
    "OUT_FOR_DELIVERY",
    "DELIVERED",
    "PAYMENT_RECEIVED",
    "PAYMENT_REMINDER",
    "ORDER_DELAYED",
    "PICKUP_SCHEDULED",
    "COMPLAINT_REGISTERED",
    "COMPLAINT_RESOLVED",
  ]),
  subject: optionalText(160),
  body: z.string().trim().min(5, "Write the message body").max(2000),
  isActive: z.boolean().default(true),
});

export const settingSchema = z.object({
  gstRate: percentSchema.default(18),
  appName: z.string().trim().min(1).max(80),
  defaultTurnaroundHours: z.coerce.number().int().min(1).max(720).default(48),
  lowStockAlerts: z.boolean().default(true),
  requireFullPaymentBeforeDelivery: z.boolean().default(false),
});

export const expenseSchema = z.object({
  branchId: cuidSchema,
  category: z.enum([
    "RENT",
    "SALARY",
    "UTILITIES",
    "MAINTENANCE",
    "TRANSPORT",
    "CONSUMABLES",
    "MARKETING",
    "MISCELLANEOUS",
  ]),
  amount: moneySchema.refine((value) => value > 0, "Enter an amount greater than zero"),
  description: z.string().trim().min(3, "Describe the expense").max(300),
  paidTo: optionalText(120),
  paymentMethod: z.enum(["CASH", "UPI", "CARD", "ONLINE", "BANK_TRANSFER"]).default("CASH"),
  reference: optionalText(120),
  expenseDate: dateSchema,
});

export const expenseDecisionSchema = z.object({
  expenseId: cuidSchema,
  status: z.enum(["APPROVED", "REJECTED", "PAID"]),
});
