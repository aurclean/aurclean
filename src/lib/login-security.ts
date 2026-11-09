import "server-only";

import { prisma } from "@/lib/prisma";
import { hashAccessCode, normalizeAccessCode, accessCodeData } from "@/lib/access-code";
import type { LoginEventType } from "@/generated/prisma/enums";

/** Failed sign-ins allowed from one client within the window before it is locked out. */
export const MAX_FAILED_ATTEMPTS = 8;
export const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;

export function clientIp(headers: Headers | { get(name: string): string | null }): string {
  return (
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headers.get("x-real-ip") ||
    "unknown"
  );
}

export async function logLoginEvent(params: {
  event: LoginEventType;
  firmId?: string | null;
  userId?: string | null;
  customerId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  detail?: string | null;
}) {
  try {
    await prisma.loginEvent.create({
      data: {
        event: params.event,
        firmId: params.firmId ?? null,
        userId: params.userId ?? null,
        customerId: params.customerId ?? null,
        ip: params.ip ?? null,
        userAgent: params.userAgent?.slice(0, 300) ?? null,
        detail: params.detail ?? null,
      },
    });
  } catch (err) {
    console.error("[login-security] could not record login event:", err);
  }
}

/**
 * Persistent (database-backed, so it survives restarts and works across
 * instances) lockout: too many failures from one client address and further
 * attempts are refused until the oldest failures age out of the window.
 */
export async function lockoutFor(ip: string): Promise<{ locked: boolean; retryAfterMs: number }> {
  if (ip === "unknown") return { locked: false, retryAfterMs: 0 };
  const since = new Date(Date.now() - LOCKOUT_WINDOW_MS);
  const failures = await prisma.loginEvent.findMany({
    where: { ip, event: { in: ["LOGIN_FAILED", "OTP_REQUESTED"] }, createdAt: { gte: since }, ...{} },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true, event: true },
  });
  const failed = failures.filter((f) => f.event === "LOGIN_FAILED");
  if (failed.length < MAX_FAILED_ATTEMPTS) return { locked: false, retryAfterMs: 0 };
  const releaseAt = failed[failed.length - MAX_FAILED_ATTEMPTS].createdAt.getTime() + LOCKOUT_WINDOW_MS;
  return { locked: true, retryAfterMs: Math.max(releaseAt - Date.now(), 1000) };
}

export interface AuthenticatedUser {
  id: string;
  name: string;
  email: string;
  image: string | null;
  role: import("@/generated/prisma/enums").UserRole;
  branchId: string | null;
  branch: { id: string; name: string; code: string } | null;
  firmId: string | null;
  firm: { id: string; name: string; status: string } | null;
  employeeCode: string | null;
}

/**
 * Resolves an access code to its single user, enforcing: client lockout,
 * account status, a per-account lock, and an active firm. Records every
 * outcome. Legacy plaintext codes are upgraded to hashes on first use.
 */
export async function authenticateAccessCode(
  rawCode: string,
  ctx: { ip: string; userAgent?: string | null },
): Promise<AuthenticatedUser | null> {
  const code = normalizeAccessCode(rawCode);
  if (!code) return null;

  const lock = await lockoutFor(ctx.ip);
  if (lock.locked) {
    await logLoginEvent({ event: "LOGIN_LOCKED", ip: ctx.ip, userAgent: ctx.userAgent, detail: "client locked out" });
    return null;
  }

  const include = {
    branch: { select: { id: true, name: true, code: true } },
    firm: { select: { id: true, name: true, status: true } },
  } as const;

  const hash = hashAccessCode(code);
  let user = await prisma.user.findUnique({ where: { accessCodeHash: hash }, include });

  if (!user) {
    const legacy = await prisma.user.findUnique({ where: { accessCode: code }, include });
    if (legacy) {
      user = await prisma.user.update({ where: { id: legacy.id }, data: accessCodeData(hash), include });
    }
  }

  if (!user) {
    await logLoginEvent({ event: "LOGIN_FAILED", ip: ctx.ip, userAgent: ctx.userAgent, detail: "unknown code" });
    return null;
  }

  const reject = async (detail: string) => {
    await logLoginEvent({ event: "LOGIN_FAILED", firmId: user!.firmId, userId: user!.id, ip: ctx.ip, userAgent: ctx.userAgent, detail });
    return null;
  };

  if (user.role === "CUSTOMER") return reject("customers use the portal");
  if (user.status !== "ACTIVE") return reject(`account ${user.status.toLowerCase()}`);
  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) return reject("account locked");
  if (user.firm && user.firm.status !== "ACTIVE") return reject(`firm ${user.firm.status.toLowerCase()}`);

  // Independent writes: issue together.
  await Promise.all([
    prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date(), failedLoginCount: 0, lockedUntil: null },
    }),
    logLoginEvent({ event: "LOGIN_SUCCESS", firmId: user.firmId, userId: user.id, ip: ctx.ip, userAgent: ctx.userAgent }),
  ]);

  return user;
}

/** Read-only: which user a code belongs to (used to pick the landing page after sign-in). */
export async function peekUserByCode(rawCode: string) {
  const code = normalizeAccessCode(rawCode);
  return prisma.user.findUnique({
    where: { accessCodeHash: hashAccessCode(code) },
    select: { id: true, role: true, firmId: true, branchId: true },
  });
}
