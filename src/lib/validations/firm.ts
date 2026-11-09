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
  /// PNG/JPEG data URI (uploaded), a /public path, or an https URL.
  logoUrl: z
    .string()
    .trim()
    .max(900_000)
    .refine(
      (v) => v === "" || /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(v) || /^\/[\w./-]+$/.test(v) || /^https:\/\//.test(v),
      "Logo must be a PNG/JPEG upload, a site path or an https URL",
    )
    .optional(),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "3-letter currency code").default("INR"),
  invoicePrefix: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{1,8}$/, "Letters/numbers, up to 8").default("INV"),
  challanPrefix: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{1,8}$/, "Letters/numbers, up to 8").default("DC"),
  /// Name of the firm's first branch (defaults to the firm name).
  branchName: optionalText(120),
  branchPhone: optionalPhone,
  // Primary admin for the new firm.
  adminName: z.string().trim().min(2, "Admin name is required").max(120),
  adminEmail: z.string().trim().toLowerCase().email("Enter a valid email address"),
  adminPhone: optionalPhone,
});

export const updateFirmSchema = z.object({
  id: cuidSchema,
  logoUrl: z.string().trim().max(900_000).optional(),
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
