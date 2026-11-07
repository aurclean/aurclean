import { z } from "zod";

import {
  cuidSchema,
  moneySchema,
  optionalText,
} from "@/lib/validations/common";

export const paymentMethodSchema = z.enum([
  "CASH",
  "UPI",
  "CARD",
  "ONLINE",
  "BANK_TRANSFER",
  "CREDIT",
  "OTHER",
]);

export const recordPaymentSchema = z.object({
  orderId: cuidSchema,
  amount: moneySchema.refine((value) => value > 0, "Enter an amount greater than zero"),
  method: paymentMethodSchema.default("CASH"),
  reference: optionalText(120),
  notes: optionalText(300),
});

export const refundSchema = z.object({
  orderId: cuidSchema,
  amount: moneySchema.refine((value) => value > 0, "Enter an amount greater than zero"),
  method: paymentMethodSchema.default("CASH"),
  reason: z.string().trim().min(3, "Give a reason for the refund").max(500),
  notes: optionalText(300),
});

export const onlinePaymentIntentSchema = z.object({
  orderId: cuidSchema,
  amount: moneySchema.refine((value) => value > 0, "Enter an amount greater than zero"),
});

export const verifyOnlinePaymentSchema = z.object({
  orderId: cuidSchema,
  amount: moneySchema,
  razorpay_order_id: z.string().min(1),
  razorpay_payment_id: z.string().min(1),
  razorpay_signature: z.string().min(1),
});
