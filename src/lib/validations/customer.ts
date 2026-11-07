import { z } from "zod";

import {
  cuidSchema,
  optionalEmail,
  optionalText,
  phoneSchema,
} from "@/lib/validations/common";

export const customerDetailsSchema = z.object({
  name: z.string().trim().min(2, "Customer name is required").max(120),
  phone: phoneSchema,
  email: optionalEmail,
  addressLine: optionalText(300),
  city: optionalText(80),
  pincode: optionalText(12),
  landmark: optionalText(120),
  notes: optionalText(1000),
});

export const createCustomerSchema = customerDetailsSchema.extend({
  branchId: cuidSchema,
});

export const updateCustomerSchema = customerDetailsSchema.extend({
  customerId: cuidSchema,
  isActive: z.coerce.boolean().default(true),
});

export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;
