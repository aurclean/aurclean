import "server-only";
import { headers } from "next/headers";

import { prisma } from "@/lib/prisma";

export interface AuditInput {
  userId?: string | null;
  branchId?: string | null;
  /**
   * Explicit tenant for a platform-level event (e.g. a Firms-module action)
   * that has no branchId to derive one from. Most callers omit this —
   * recordAudit() derives firmId from branchId itself, since a branch only
   * ever belongs to one firm and threading firmId through every one of the
   * ~50 call sites across the app would be both invasive and easy to miss
   * at a few of them, the exact class of bug that left every audit entry
   * firmless until this was added.
   */
  firmId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  summary?: string | null;
  before?: unknown;
  after?: unknown;
}

/** Strip secrets before anything is written to the audit trail. */
const REDACTED_KEYS = new Set([
  "password",
  "passwordHash",
  "confirmPassword",
  "accessCode",
  "token",
  "secret",
  "apiKey",
  "providerSignature",
]);

function sanitize(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map(sanitize);
  if (typeof value === "object") {
    if (value instanceof Date) return value.toISOString();
    const source = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(source)) {
      if (REDACTED_KEYS.has(key)) {
        result[key] = "[redacted]";
        continue;
      }
      if (val !== null && typeof val === "object" && "toNumber" in (val as object)) {
        result[key] = (val as { toNumber: () => number }).toNumber();
        continue;
      }
      result[key] = sanitize(val);
    }
    return result;
  }
  return value;
}

/**
 * Writes an audit entry. Audit failures must never break the business
 * operation that triggered them, so errors are swallowed and logged.
 */
export async function recordAudit(input: AuditInput): Promise<void> {
  try {
    let ipAddress: string | null = null;
    let userAgent: string | null = null;

    try {
      const headerList = await headers();
      ipAddress =
        headerList.get("x-forwarded-for")?.split(",")[0]?.trim() ??
        headerList.get("x-real-ip") ??
        null;
      userAgent = headerList.get("user-agent");
    } catch {
      // Outside a request scope (e.g. seeding) — headers are unavailable.
    }

    let firmId = input.firmId ?? null;
    if (!firmId && input.branchId) {
      const branch = await prisma.branch.findUnique({
        where: { id: input.branchId },
        select: { firmId: true },
      });
      firmId = branch?.firmId ?? null;
    }

    await prisma.auditLog.create({
      data: {
        userId: input.userId ?? null,
        branchId: input.branchId ?? null,
        firmId,
        action: input.action,
        entity: input.entity,
        entityId: input.entityId ?? null,
        summary: input.summary ?? null,
        before: input.before === undefined ? undefined : (sanitize(input.before) as never),
        after: input.after === undefined ? undefined : (sanitize(input.after) as never),
        ipAddress,
        userAgent,
      },
    });
  } catch (error) {
    console.error("[audit] failed to record entry", error);
  }
}
