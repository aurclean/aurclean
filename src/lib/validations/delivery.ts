import { z } from "zod";

import {
  cuidSchema,
  dateSchema,
  moneySchema,
  optionalText,
  phoneSchema,
} from "@/lib/validations/common";

export const createDeliverySchema = z.object({
  orderId: cuidSchema,
  scheduledAt: dateSchema,
  contactName: z.string().trim().min(2, "Contact name is required").max(120),
  contactPhone: phoneSchema,
  addressLine: z.string().trim().min(5, "Delivery address is required").max(300),
  landmark: optionalText(120),
  driverId: z
    .string()
    .trim()
    .transform((value) => (value === "" || value === "none" ? null : value))
    .nullable()
    .optional(),
  isPartial: z.boolean().default(false),
  notes: optionalText(300),
});

export const assignDriverSchema = z.object({
  jobId: cuidSchema,
  jobType: z.enum(["PICKUP", "DELIVERY"]),
  driverId: cuidSchema,
});

export const advancePickupSchema = z.object({
  pickupId: cuidSchema,
  status: z.enum([
    "DRIVER_ACCEPTED",
    "PICKED_UP",
    "RECEIVED_AT_LAUNDRY",
    "FAILED",
    "CANCELLED",
  ]),
  note: optionalText(300),
});

export const completeDeliverySchema = z.object({
  deliveryId: cuidSchema,
  outcome: z.enum(["DELIVERED", "FAILED", "RESCHEDULED"]),
  receivedByName: optionalText(120),
  amountCollected: moneySchema.default(0),
  collectionMethod: z
    .enum(["CASH", "UPI", "CARD", "ONLINE", "BANK_TRANSFER", "OTHER"])
    .default("CASH"),
  failureReason: optionalText(300),
  rescheduledFor: z
    .union([z.coerce.date(), z.literal(""), z.null(), z.undefined()])
    .transform((value) =>
      value === "" || value === null || value === undefined ? null : value,
    ),
  notes: optionalText(300),
});

export const dispatchSchema = z.object({
  deliveryId: cuidSchema,
});
