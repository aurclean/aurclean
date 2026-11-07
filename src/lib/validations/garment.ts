import { z } from "zod";

import { cuidSchema, optionalText } from "@/lib/validations/common";

export const scanSchema = z.object({
  code: z.string().trim().min(1, "Scan or enter a code").max(64),
});

export const garmentUpdateSchema = z.object({
  garmentId: cuidSchema,
  color: optionalText(40),
  brand: optionalText(60),
  size: optionalText(20),
  fabric: optionalText(60),
  stainNotes: optionalText(500),
  damageNotes: optionalText(500),
});

export const advanceStageSchema = z.object({
  garmentId: cuidSchema,
  stage: z.enum([
    "RECEIVING",
    "SORTING",
    "WASHING",
    "DRYING",
    "IRONING",
    "QUALITY_CHECK",
    "PACKING",
    "DISPATCH",
  ]),
  outcome: z.enum([
    "PENDING",
    "IN_PROGRESS",
    "COMPLETED",
    "PASSED",
    "FAILED",
    "REWASH",
    "REWORK",
    "SKIPPED",
  ]),
  note: optionalText(500),
  scannedVia: z.string().optional(),
  /** The order the station had open, so a wrong-order read is caught. */
  contextOrderId: z
    .string()
    .trim()
    .transform((value) => (value === "" || value === "none" ? null : value))
    .nullable()
    .optional(),
});

export const bulkAdvanceSchema = advanceStageSchema
  .omit({ garmentId: true })
  .extend({
    garmentIds: z.array(cuidSchema).min(1, "Select at least one garment"),
  });

export const markGarmentSchema = z.object({
  garmentId: cuidSchema,
  status: z.enum(["LOST", "DAMAGED", "RETURNED"]),
  note: z.string().trim().min(3, "Describe what happened").max(500),
});
