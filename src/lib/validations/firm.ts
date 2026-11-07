import { z } from "zod";

import { cuidSchema, optionalEmail, optionalPhone, optionalText } from "@/lib/validations/common";

export const createFirmSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .min(2, "Firm code is required")
    .max(20)
    .regex(/^[A-Z0-9_-]+$/, "Letters, numbers, - and _ only"),
  name: z.string().trim().min(2, "Business name is required").max(120),
  legalName: optionalText(160),
  addressLine: optionalText(300),
  city: optionalText(80),
  state: optionalText(80),
  pincode: optionalText(12),
  phone: optionalPhone,
  email: optionalEmail,
  gstin: optionalText(20),
  pan: optionalText(20),
  website: optionalText(160),
  // Primary admin for the new firm.
  adminName: z.string().trim().min(2, "Admin name is required").max(120),
  adminEmail: z.string().trim().toLowerCase().email("Enter a valid email address"),
  adminPhone: optionalPhone,
});

export const updateFirmSchema = z.object({
  id: cuidSchema,
  name: z.string().trim().min(2).max(120),
  legalName: optionalText(160),
  addressLine: optionalText(300),
  city: optionalText(80),
  state: optionalText(80),
  pincode: optionalText(12),
  phone: optionalPhone,
  email: optionalEmail,
  gstin: optionalText(20),
  pan: optionalText(20),
  website: optionalText(160),
});
