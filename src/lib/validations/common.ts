import { z } from "zod";

export const cuidSchema = z.string().min(1, "Required");

export const optionalCuid = z
  .string()
  .trim()
  .transform((value) => (value === "" || value === "none" ? null : value))
  .nullable()
  .optional();

export const phoneSchema = z
  .string()
  .trim()
  .regex(/^[+0-9][0-9\s-]{6,19}$/, "Enter a valid phone number");

export const optionalPhone = z
  .string()
  .trim()
  .transform((value) => (value === "" ? null : value))
  .nullable()
  .optional()
  .refine(
    (value) => value === null || value === undefined || /^[+0-9][0-9\s-]{6,19}$/.test(value),
    "Enter a valid phone number",
  );

export const optionalEmail = z
  .string()
  .trim()
  .transform((value) => (value === "" ? null : value))
  .nullable()
  .optional()
  .refine(
    (value) => value === null || value === undefined || z.string().email().safeParse(value).success,
    "Enter a valid email address",
  );

export const optionalText = (max = 2000) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === "" ? null : value))
    .nullable()
    .optional();

export const moneySchema = z
  .coerce.number()
  .min(0, "Cannot be negative")
  .max(99_999_999, "Amount is too large")
  .transform((value) => Math.round(value * 100) / 100);

export const quantitySchema = z.coerce
  .number()
  .int("Must be a whole number")
  .min(1, "Must be at least 1")
  .max(5000, "That is too many pieces for one line");

export const weightSchema = z.coerce
  .number()
  .min(0, "Cannot be negative")
  .max(10_000, "Weight is too large")
  .transform((value) => Math.round(value * 1000) / 1000);

export const percentSchema = z.coerce
  .number()
  .min(0, "Cannot be negative")
  .max(100, "Cannot exceed 100");

export const dateSchema = z.coerce.date({ message: "Enter a valid date" });

export const optionalDate = z
  .union([z.coerce.date(), z.literal(""), z.null(), z.undefined()])
  .transform((value) => (value === "" || value === null || value === undefined ? null : value));

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

/** Reads a checkbox from FormData, where "on"/"true" both mean checked. */
export const checkboxSchema = z
  .union([z.literal("on"), z.literal("true"), z.literal("false"), z.literal(""), z.undefined(), z.boolean()])
  .transform((value) => value === "on" || value === "true" || value === true);

/** Parses a JSON string field posted from a form. */
export function jsonField<T extends z.ZodTypeAny>(schema: T) {
  return z.string().transform((value, ctx) => {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      ctx.addIssue({ code: "custom", message: "Malformed data" });
      return z.NEVER;
    }
  }).pipe(schema);
}
