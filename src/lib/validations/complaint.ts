import { z } from "zod";

import {
  cuidSchema,
  moneySchema,
  optionalCuid,
  optionalPhone,
  optionalText,
} from "@/lib/validations/common";

export const complaintTypeSchema = z.enum([
  "DAMAGED_GARMENT",
  "LOST_GARMENT",
  "MISSING_GARMENT",
  "COLOR_FADING",
  "STAIN_NOT_REMOVED",
  "WRONG_GARMENT",
  "WRONG_QUANTITY",
  "LATE_DELIVERY",
  "OTHER",
]);

export const createComplaintSchema = z.object({
  branchId: cuidSchema,
  type: complaintTypeSchema,
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).default("MEDIUM"),
  orderId: optionalCuid,
  garmentId: optionalCuid,
  raisedByName: z.string().trim().min(2, "Who raised this complaint?").max(120),
  raisedByPhone: optionalPhone,
  description: z.string().trim().min(10, "Describe the problem in a little more detail").max(2000),
  assignedToId: optionalCuid,
});

export const updateComplaintSchema = z.object({
  complaintId: cuidSchema,
  status: z
    .enum(["OPEN", "UNDER_INVESTIGATION", "AWAITING_CUSTOMER", "REJECTED", "CLOSED"])
    .optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
  assignedToId: optionalCuid,
  investigationNotes: optionalText(2000),
});

export const resolveComplaintSchema = z.object({
  complaintId: cuidSchema,
  resolution: z.enum([
    "REFUND",
    "REWASH",
    "REWORK",
    "COMPENSATION",
    "REPLACEMENT",
    "APOLOGY",
    "NO_ACTION",
  ]),
  resolutionNotes: z.string().trim().min(5, "Explain how this was resolved").max(2000),
  compensationAmount: moneySchema.default(0),
});
