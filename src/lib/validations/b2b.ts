import { z } from "zod";

import {
  cuidSchema,
  dateSchema,
  moneySchema,
  optionalDate,
  optionalEmail,
  optionalText,
  phoneSchema,
} from "@/lib/validations/common";

export const b2bAccountSchema = z.object({
  id: z.string().optional(),
  code: z
    .string()
    .trim()
    .min(2, "Code is required")
    .max(20)
    .regex(/^[A-Za-z0-9-]+$/, "Use letters, digits or hyphens only")
    .transform((value) => value.toUpperCase()),
  businessName: z.string().trim().min(2, "Business name is required").max(160),
  type: z.enum([
    "HOTEL",
    "HOSPITAL",
    "HOSTEL",
    "RESTAURANT",
    "SALON",
    "GYM",
    "CORPORATE",
    "OTHER",
  ]),
  contactPerson: optionalText(120),
  phone: phoneSchema,
  email: optionalEmail,
  billingAddress: optionalText(300),
  gstNumber: optionalText(20),
  creditLimit: moneySchema.default(0),
  creditDays: z.coerce.number().int().min(0).max(365).default(30),
  paymentTerms: optionalText(160),
  branchId: z
    .string()
    .trim()
    .transform((value) => (value === "" || value === "none" ? null : value))
    .nullable()
    .optional(),
  isActive: z.boolean().default(true),
});

export const contractSchema = z.object({
  id: z.string().optional(),
  accountId: cuidSchema,
  startDate: dateSchema,
  endDate: optionalDate,
  billingCycle: z.enum(["WEEKLY", "FORTNIGHTLY", "MONTHLY"]).default("MONTHLY"),
  minimumMonthlyValue: moneySchema.default(0),
  status: z.enum(["DRAFT", "ACTIVE", "EXPIRED", "TERMINATED"]).default("ACTIVE"),
  terms: optionalText(2000),
});

export const rateCardSchema = z.object({
  contractId: cuidSchema,
  serviceId: cuidSchema,
  garmentTypeId: z
    .string()
    .trim()
    .transform((value) => (value === "" || value === "all" ? null : value))
    .nullable()
    .optional(),
  pricingMode: z.enum(["PER_PIECE", "PER_KG", "FLAT"]).default("PER_PIECE"),
  rate: moneySchema,
  effectiveFrom: dateSchema,
  effectiveTo: optionalDate,
});

export const scheduleSchema = z.object({
  accountId: cuidSchema,
  type: z.enum(["PICKUP", "DELIVERY"]),
  dayOfWeek: z.coerce.number().int().min(0).max(6),
  timeSlot: z.string().trim().min(1, "Give a time slot").max(40),
  notes: optionalText(200),
});

export const statementSchema = z.object({
  accountId: cuidSchema,
  periodStart: dateSchema,
  periodEnd: dateSchema,
});
