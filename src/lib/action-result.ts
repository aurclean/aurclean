import { z } from "zod";
import { AuthenticationError, AuthorizationError } from "@/lib/session";

export type FieldErrors = Record<string, string[]>;

export type ActionResult<T = void> =
  | { ok: true; data: T; message?: string }
  | { ok: false; error: string; fieldErrors?: FieldErrors };

export function ok<T>(data: T, message?: string): ActionResult<T> {
  return { ok: true, data, message };
}

export function fail(error: string, fieldErrors?: FieldErrors): ActionResult<never> {
  return { ok: false, error, fieldErrors };
}

/** Domain errors that are safe to show verbatim to the user. */
export class BusinessRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BusinessRuleError";
  }
}

export class NotFoundError extends Error {
  constructor(message = "The requested record could not be found") {
    super(message);
    this.name = "NotFoundError";
  }
}

/**
 * Wraps a server action so that thrown errors become structured results
 * instead of unhandled exceptions, without leaking internals to the client.
 */
export async function runAction<T>(
  fn: () => Promise<T>,
): Promise<ActionResult<T>> {
  try {
    return ok(await fn());
  } catch (error) {
    return toActionResult(error);
  }
}

export function toActionResult(error: unknown): ActionResult<never> {
  if (error instanceof z.ZodError) {
    return fail("Please correct the highlighted fields", flattenZodError(error));
  }
  if (
    error instanceof BusinessRuleError ||
    error instanceof NotFoundError ||
    error instanceof AuthorizationError ||
    error instanceof AuthenticationError
  ) {
    return fail(error.message);
  }
  if (isPrismaUniqueViolation(error)) {
    const meta = (error as { meta?: { target?: string[] | string } })?.meta;
    const target = Array.isArray(meta?.target)
      ? meta.target.join(", ")
      : typeof meta?.target === "string"
        ? meta.target
        : null;

    const fieldErrors: FieldErrors = {};
    if (Array.isArray(meta?.target)) {
      for (const field of meta.target) {
        fieldErrors[field] = [`This ${field} is already in use`];
      }
    }

    const message = target
      ? `A record with this ${target.replace(/_/g, " ")} already exists`
      : "A record with these details already exists";

    return fail(message, Object.keys(fieldErrors).length > 0 ? fieldErrors : undefined);
  }
  if (isPrismaForeignKeyViolation(error)) {
    return fail("This record is referenced elsewhere and cannot be changed");
  }

  console.error("[action] unexpected error", error);
  return fail("Something went wrong. Please try again.");
}

export function flattenZodError(error: z.ZodError): FieldErrors {
  const fieldErrors: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_form";
    (fieldErrors[key] ??= []).push(issue.message);
  }
  return fieldErrors;
}

function hasPrismaCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}

export const isPrismaUniqueViolation = (error: unknown) =>
  hasPrismaCode(error, "P2002");
export const isPrismaForeignKeyViolation = (error: unknown) =>
  hasPrismaCode(error, "P2003");
export const isPrismaNotFound = (error: unknown) => hasPrismaCode(error, "P2025");

/** Maps an error to an HTTP status for route handlers. */
export function errorStatus(error: unknown): number {
  if (error instanceof AuthenticationError) return 401;
  if (error instanceof AuthorizationError) return 403;
  if (error instanceof NotFoundError || isPrismaNotFound(error)) return 404;
  if (error instanceof BusinessRuleError) return 409;
  if (error instanceof z.ZodError) return 422;
  return 500;
}
